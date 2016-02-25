/*
 * PathfinderPC Server Interface
 *
 * Chris Roberts <chris@naxxfish.eu>
 *
 * See www.pathfinderpc.com for information about PathfinderPC. 
 *
 * This module will interface with a PathfinderPC instance, and synchronise itself with it.
 * the consumer can then issue find requests to get information out of the database, or 
 * subscribe to various events that are triggered when things change.
 *
 * The way this works is by connecting, issuing a number of commands to initialise the database to
 * a known state.  It will also do Subscribe Memory and Subscribe Silence All, so any further changes to
 * memory slots will be updated as soon as they are detected
 * 
 * Routes don't seem to trigger updates, so we occasionally poll for them to keep them up to date.
 */
 
// basic imports
var events = require('events');
var debug = require('debug')('pfint')

// we need this which only exists in EMCA6
if (!String.prototype.endsWith) {
	String.prototype.endsWith = function(searchString, position) {
		var subjectString = this.toString();
		if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
			position = subjectString.length
		}
		position -= searchString.length
		var lastIndex = subjectString.indexOf(searchString, position)
		return lastIndex !== -1 && lastIndex === position
	};
}


module.exports = PFInt

function PFInt()
{
	var connected = false;
	var subscribed = false
	events.EventEmitter.call(this)
}

PFInt.super_ = events.EventEmitter

PFInt.prototype = Object.create(events.EventEmitter.prototype, {
    constructor: {
        value: PFInt,
        enumerable: false
    }
});

;
	
// We initially run these commands when we connect
var commandQueue = []
	
var Datastore = require('nedb')
var state =  new Datastore()
var events = require('events')

PFInt.prototype.find = function find(query, cb)
{
	var self = this
	state.find(query,cb)
	return self
}

PFInt.prototype.findOne = function find(query, cb)
{
	var self = this
	debug(query)
	state.findOne(query,cb)
	return self
}

PFInt.prototype.setMemorySlot = function setMemorySlot(memorySlot, memorySlotValue, cb)
{
	var self = this
	if (memorySlot === undefined || memorySlot === null || memorySlotValue === undefined || memorySlotValue === null)
	{
		cb('passed undefined',{'error':'memorySlot or memorySlotValue not defined'})
		return;
	}
	if (memorySlotValue.length > 19979)
	{
		cb('memory slot value too long',{'error':'memoryslot value too long'})
		return;
	}
	
	if (memorySlot.length >= 19998) // yes, you read that right, the name can actually be longer than the value. 
	{
		cb('memory slot name too long', {'error':'memory slot name too long'})
		return;
	}
	if (self.connected)
	{
		// check that the memoryslot value given is actually defined... 
		debug('setMemorySlot',{'memorySlot':memorySlot,'memorySlotValue':memorySlotValue})
		commandQueue.push("SetMemorySlot " + memorySlot + "=" + memorySlotValue + "\r\n")
		sendCommands(state,self.client)
		/*
			At this point, we've sent the command to Pathfinder to set the memory slot.  
			Shortly, it'll come back with the confirmation that that MemorySlot has been set - so we subscribe to our
			own event listener and wait until we see the memory slot get updated.  
		*/
		var updateEvent = function (slot) 
		{
			if (slot.name == memorySlot)
			{
				self.removeListener('memorySlot',updateEvent)
				self.findOne({'itemType' : 'memoryslot','name':memorySlot},cb)
			}
		}
		self.on('memorySlot',updateEvent)
	}
}

var linesToParse = []
PFInt.prototype.sync = function sync(config)
{
	debug("sync")
	var self = this;
	self.config = config
	var net = require('net');
	state.update(
		{'itemType' : 'pathfinderserver'},
		{ $set : {
			'connected' : false, 
			'loggedIn' : false,
			'host' : config['host'],
			'port' : config['port']
			} }, {'upsert' : true }
	)

	self.client = net.connect({host: config['host'], port: config['port']},
		function() { //'connect' listener
			// when we first connect, we want to run all of these commands
			commandQueue.push("Login " + config['user'] + " " + config['password'])
			commandQueue.push("Version")
			commandQueue.push("Subscribe Memory")
			commandQueue.push("Subscribe Silence All")
			commandQueue.push("GetMemorySlot All")
			commandQueue.push("GetList Routers")
			sendCommands(state,self.client)
			setTimeout(function() { sendCommands(state,self.client) },1000) // in case the results of all the above commands create more commands to execute
			self.connected = true
			debug('Connected')
			self.emit('connected')
			state.update(
						{'itemType' : 'pathfinderserver'},
						{ $set : {'connected' : true} }, {'upsert' : true }
			)
			var readBuffer = "";
			self.client.on('data', function(data) {
				//debug("From PF",data.toString())
				readBuffer = readBuffer + data.toString()
				//debug("readBuffer",readBuffer)
				// if the message does not end with a \r\n>>, then there will be a continuation so wait for that.
				if (!readBuffer.endsWith("\r\n>>"))
				{
					return;
				}
				lines = readBuffer.split("\r\n")
				readBuffer = "";
				lines.forEach(function (line) {
					
					if (line.indexOf(">>") == 0)
					{
						self.parseLines(self,linesToParse)
						linesToParse = []
						if (line.length > 2)
						{
							linesToParse.push(line.substr(2))
						}
					} else {
						linesToParse.push(line)
					}
				})
			});
	})
	
	self.client.on('error', function(error) {
		debug("Connection Error: ", error)
		self.emit('error', error)
		self.connected = false
		self.subscribed = false
		setTimeout(function() { self.sync(config, state) }, 10000)
	})
	
	self.client.on('end', function() {
		debug('Disconnected');
		state.update(
					{'itemType' : 'pathfinderserver'},
					{ $set : {'connected' : false, 'loggedIn' : false} }, {'upsert' : true }
		)
		self.connected = false
		self.subscribed = false
		self.emit('disconnected')
		debug('reconnecting in 10 seconds')
		setTimeout(function ()
		{
			self.sync(config,state);
		}, 10000);
	})

	return self
}

PFInt.prototype.parseLines = function (self, lines)
{
				config = self.config
				client = self.client
				firstLine = lines.shift()
				
				if (firstLine.indexOf(">>") == 0)
				{
					firstLine = lines.shift()
				}
				
				if (firstLine.indexOf("Login") >= 0)
				{
					debug("login",firstLine)
					if (firstLine.indexOf("Successful") > 0)
					{
						debug("PF Login succeeded!")
						state['connected'] = true
						state.update(
							{'itemType' : 'pathfinderserver'},
							{ $set : {
								'loggedIn' : true, 
								'logonMessage' : firstLine, 
								'logonUser' : config['user']
								} 
							},
							{'upsert' : true }
						)
						sendCommands(state, client);
						return
					} else {
						debug("PF Login failed")
						state['connected'] = false
						client.end();
						// retry
						setTimeout(function() { exports.sync(config, state) }, 10000);
						return
					}
					
				}
				

				if (firstLine.indexOf("Error") >= 0)
				{
					debug("PF Error" + firstLine)
					sendCommands(state, client);
				}
				
				if (firstLine.indexOf("PathfinderPC Server") >= 0)
				{
					debug("version",firstLine)
					state.update(
						{'itemType' : 'pathfinderserver'},
						{ $set : {'version' : firstLine} }, {'upsert' : true }
					)
				}
				
				if (firstLine.indexOf("Begin User Command") >= 0)
				{
					debug("User command")
					// a custom protocol translator command has been fired!
					lines.forEach(function (line)
					{
						if (line.indexOf("End User Command") == -1)
						{
							self.emit('customCommand', line)
						}
					})
				}
				
				if (firstLine.indexOf("MemorySlot") >= 0)
				{
					lines.unshift(firstLine)
					lines.forEach(function (line)
					{
						if (line.indexOf(">>") == 0)
							return 
						
						if (line.length < 2) 
							return
						
						def = line.substring(line.indexOf(" ")+1)
						parts = def.split('\t');
						//MemorySlot lines should have 3 fields, slot number, optional name, value
						// if the value is blank, then don't store it.  
						if (parts.length == 3 && parts[2] != '')
						{
							var slot = null
							if (parts[1] == '') 
							{ // no name
								slot = {
									'itemType' : 'memoryslot',
									'number' : parts[0],
									'value' : parts[2]
								}
							} else  {
								// only has a number
								slot = {
									'itemType' : 'memoryslot',
									'number' : parts[0],
									'name' : parts[1],
									'value' : parts[2]
								}
							}
							
							if (slot != null)
							{
								debug('memoryslot',slot);
								state.update(
									{'itemType' : 'memoryslot',
									'number' : parts[0]
									},
									slot,
										{'upsert' : true}
									)
								self.emit('memorySlot', slot)
							} else {
								debug("slot error",line)
							}	
						}
						
					});
					return
				}
				if (firstLine.indexOf("RouteStat") >= 0)
				{
					debug('routestat',firstLine)
					lines.forEach(function (line)
					{
						if (line.indexOf(">>") == 0)
						{	return }
						//
						if (line.length < 2) {
							return
						}
						def = line.substring(line.indexOf(" ")+1)
						parts = def.split('\t');
						debug(parts)
						if (parts[1] != "")
						{
							var slot = {
								'itemType' : 'route',
								'source' : parts[1],
								'destination' : parts[2],
								'locked' : parts[3]
								}
								debug(slot)
							state.update(
								{'itemType' : 'route',
								'destination': parts[2]
								},
								slot,
									{'upsert' : true}
								)
							self.emit('memorySlot', slot)
						}
					});
					return					
				}
				
				if (firstLine.indexOf("GPIStat") >= 0)
				{
					debug('gpistat',firstLine)
					lines.push(firstLine)
					lines.forEach( function (line) {
						if (line.indexOf(">>") == 0)
						{	return }
						//
						if (line.length < 2) {
							return
						}
						def = line.substring(line.indexOf(" ")+1)
						parts = def.split('\t');
						//GPOStat <RouterNumber> <DestinationNumber> <GPIState>
						var gpi = {
							'itemType' : 'gpi', 
							'router' : parts[1],
							'destinationid' : parts[2],
							'state' : parts[3]
							}
							debug(gpi)
						state.update({
							'itemType' : 'gpi', 
							'router' : parts[1],
							'destinationid' : parts[2]
							}, { $set : gpi }, {'upsert' : true});
						self.emit('gpi', gpi)
					});
				}
				
				if (firstLine.indexOf("Subscribed") >= 0)
				{
					debug('subscribed',firstLine)
					self.subscribed = true
					self.emit('subscribed', firstLine)
				}
				
				if (firstLine.indexOf("BeginList") >= 0)
				{
					self.parseList(firstLine, lines, state, client)
				}
}

/* GetList parsing method */
PFInt.prototype.parseList = function parseList(firstLine, lines, state, client)
{
	var self = this
	bits = firstLine.split(" ")
	list = bits[1].toLowerCase()
	nextBit = bits[2]
	header = lines.shift().split("\t")
	for (var i in header)
	{
		header[i] = header[i].toLowerCase()
	}
	
	lines.forEach(function (line)
	{
		if (line.indexOf(">>") == 0)
		{	return }
		
		if (line.length < 2)
		{	return }
		
		if (line.indexOf("EndList") ==0)
		{
			return
		}
		parts = line.split("\t")
		var entry = {}
		for (var i in parts)
		{
			entry[header[i]] = parts[i]
		}
		if (list == "routers")
		{
			entry = parseRouter(entry)
			state.update({'itemType' : 'router', 'id' : entry['id']}, { $set: entry }, {'upsert' : true})
			self.emit('router', entry)
		} else if (list.indexOf("sourcedetails") == 0)
		{
			entry = parseSource(nextBit, entry)
			state.update({'itemType' : 'source', 'id' : entry['id']}, {$set : entry}, {'upsert' : true})
			self.emit('source', entry)
		} else if (list.indexOf("destinationdetails") == 0)
		{
			entry = parseDestination(nextBit, entry)
			state.update({'itemType' : 'destination', 'destinationid' : entry['id']}, {$set: entry }, {'upsert' : true})
			self.emit('destination', entry)
		} else if (list.indexOf("routestats") == 0)
		{
			entry = parseRoute(nextBit, entry, state) // need to parse state so we can delete routes that conflict
			state.update(
				{
					'itemType' : 'route', 
					'destinationid' : entry['destinationid']
				},  
				{$set : entry}, 
				{'upsert' : true }
			)
			self.emit('route', entry)
		} else if (list.indexOf("protocoltranslators") == 0)
		{
			entry = parseProtocolTranslator(entry)
			state.update(
				{
					'itemType' : 'protocoltranslator', 
					'id' : entry['id']
				}, 
				{$set : entry}, 
				{'upsert' : true})
			self.emit('protocoltranslator', entry)
		}
	})
	
	return
}

/*  GetList parsing methods */
/*
0 = Available 
1 = User Locked 
2 = System Locked 
3 = Disabled Stream 
4 = Host Device is offline 
5 = Service Not Running 
*/
var availMap = [
	'Available', 
	'UserLocked',
	'SystemLocked',
	'DisabledStream',
	'HostOffline',
	'ServiceNotRunning'
	]
/* Parses router lists */
function parseRouter(router)
{
	router['avail'] = availMap[router['avail']]
	router['itemType'] = "router"
	// Add to the resync list
	commandQueue.push("GetList SourceDetails " + router['id'])
	commandQueue.push("GetList DestinationDetails " + router['id'])
	//commandQueue.push("GetList RouteStats "+ router['id'])
	//commandQueue.push("GPIStat " + router['id'])
	//commandQueue.push("GPOStat " + router['id'])
	return router
}

/* Parses source lists */
function parseSource(routerId, source)
{
	source['itemType'] = "source"
	source['sourceId'] = source['id']
	source['routerId'] = routerId
	source['avail'] = availMap[source['avail']]
	return source
}
/* Parses protocol translators */
function parseProtocolTranslator(pt)
{
	pt['itemType'] = "protocoltranslator"
	pt['avail'] = availMap[pt['avail']]
	return pt
}

/* Parses Destination Lists */
function parseDestination(routerId, destination)
{
	destination['itemType'] = "destination"
	destination['destinationId'] = destination['id']
	destination['routerId'] = routerId
	destination['avail'] = availMap[destination['avail']]
	return destination
}


function parseRoute(routerId, route, state)
{
	route['itemType'] = "route"
	route['routerId'] = routerId
	route['avail'] = availMap[route['avail']]
	return route
}
/*  This gets run every now and then, to keep us in sync with Pathfinder. */
function sendCommands(state, connection)
{
	nextCommand = commandQueue.shift()
	
	while (nextCommand)
	{
		debug("sending command",nextCommand)
		connection.write(nextCommand  + "\r\n")
		nextCommand = commandQueue.shift()
	} 
}
