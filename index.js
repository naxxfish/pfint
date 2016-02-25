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

if (!String.prototype.endsWith) {
  String.prototype.endsWith = function(searchString, position) {
      var subjectString = this.toString();
      if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
        position = subjectString.length;
      }
      position -= searchString.length;
      var lastIndex = subjectString.indexOf(searchString, position);
      return lastIndex !== -1 && lastIndex === position;
  };
}


module.exports = PFInt;

function PFInt()
{
	events.EventEmitter.call(this);
}

PFInt.super_ = events.EventEmitter;
PFInt.prototype = Object.create(events.EventEmitter.prototype, {
    constructor: {
        value: PFInt,
        enumerable: false
    }
});

var commandQueue = [
	"Version",
	"Subscribe Memory",
	"Subscribe Silence All",
	"GetMemorySlot All",
	"GetList Routers"]
	
var subscribed = false

var Datastore = require('nedb')
var state =  new Datastore();
var events = require('events');

PFInt.prototype.find = function find(query, cb)
{
	var self = this;
	state.find(query,cb)
	return self
}

PFInt.prototype.findOne = function find(query, cb)
{
	var self = this;
	debug(query);
	state.findOne(query,cb)
	return self
}

PFInt.prototype.setMemorySlot = function setMemorySlot(memorySlot, memorySlotValue, cb)
{
	var self = this;
	if (memorySlot === undefined || memorySlot === null || memorySlotValue === undefined || memorySlotValue === null)
	{
		cb('passed undefined',{'error':'memorySlot or memorySlotValue not defined'});
		return;
	}
	if (self.connected)
	{
		// check that the memoryslot value given is actually defined... 
		debug({'action':'set','memorySlot':memorySlot,'memorySlotValue':memorySlotValue})
		debug("SetMemorySlot " + memorySlot + "=" + memorySlotValue + "\r\n");
		self.client.write("SetMemorySlot " + memorySlot + "=" + memorySlotValue + "\r\n");
		/*
			At this point, we've sent the command to Pathfinder to set the memory slot.  
			Shortly, it'll come back with the confirmation that that MemorySlot has been set - so we subscribe to our
			own event listener and wait until we see the memory slot get updated.  
		*/
		var updateEvent = function (slot) 
		{
			if (slot.name == memorySlot)
			{
				self.removeListener('memorySlot',updateEvent);
				self.findOne({'itemType' : 'memoryslot','name':memorySlot},cb)
			}
		}
		self.on('memorySlot',updateEvent);
	}
}

var linesToParse = []
PFInt.prototype.sync = function sync(config)
{
	debug("sync");
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
			self.connected = true;
			debug('Connected')
			self.emit('connected')
			self.client.write("Login " + config['user'] + " " + config['password'] + "\r\n");
			state.update(
						{'itemType' : 'pathfinderserver'},
						{ $set : {'connected' : true} }, {'upsert' : true }
			)
			var readBuffer = "";
			self.client.on('data', function(data) {
				debug("From PF",data.toString())
				readBuffer = readBuffer + data.toString();
				debug("readBuffer",readBuffer);
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
		setTimeout(function() { exports.sync(config, state) }, 10000);
	})
	
	self.client.on('end', function() {
		debug('Disconnected');
		state.update(
					{'itemType' : 'pathfinderserver'},
					{ $set : {'connected' : false, 'loggedIn' : false} }, {'upsert' : true }
		)
		self.emit('disconnected')
		debug('reconnecting in 10 seconds')
		setTimeout(10000, function ()
		{
			stompClient.connect();
		});
	})

	return self
}

PFInt.prototype.parseLines = function (self, lines)
{
				config = self.config
				client = self.client
				firstLine = lines.shift()
				
				if (firstLine == ">>")
				{
					firstLine = lines.shift()
				}
				
				if (firstLine.indexOf("Login") >= 0)
				{
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
						resync(state, client);
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
					resync(state, client);
				}
				
				if (firstLine.indexOf("PathfinderPC Server") >= 0)
				{
					state.update(
						{'itemType' : 'pathfinderserver'},
						{ $set : {'version' : firstLine} }, {'upsert' : true }
					)
					resync(state, client)
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
					resync(state, client)
				}
				
				if (firstLine.indexOf("MemorySlot") >= 0)
				{
					debug('memoryslot')
					lines.push(firstLine)
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
						if (parts[1] != "")
						{
							var slot = {
								'itemType' : 'memoryslot',
								'number' : parts[0],
								'name' : parts[1],
								'value' : parts[2]
								}
								debug(slot);
							state.update(
								{'itemType' : 'memoryslot',
								'number' : parts[0]
								},
								slot,
									{'upsert' : true}
								)
							self.emit('memorySlot', slot)
						}
					});
					resync(state, client)
					return
				}
				if (firstLine.indexOf("RouteStat") >= 0)
				{
					debug('routestat')
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
					resync(state, client)
					return					
				}
				
				if (firstLine.indexOf("GPIStat") >= 0)
				{
					debug('gpistat')
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
					resync(state, client)
				}
				
				if (firstLine.indexOf("Subscribed") >= 0)
				{
					debug('subscribed')
					subscribed = true
					self.emit('subscribed', firstLine)
					resync(state, client)
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
			resync(state, client)
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
function resync(state, connection)
{
	nextCommand = commandQueue.shift()
	if (nextCommand)
	{
		connection.write(nextCommand  + "\r\n")
	} else {/*
		// requery all routers
		routers = state.find({'itemType' : 'router'}, 
			function (err, routers) {
			// queue up GPIO stat and RouteStat for all the routers
			routers.forEach(function(router) {
				// should probably only do this for GPIO routers
				if(router['type'] == "AxiaGPIO")
				{
					commandQueue.push("GPIStat " + router['id']);
					commandQueue.push("GPOStat " + router['id']);
				}
				commandQueue.push("GetList RouteStats " + router['id']);
				
			})
			
		});
		if (!subscribed)
		{
			commandQueue.push("GetMemorySlot All")
		}
		commandQueue.push("GetList ProtocolTranslators")
		*/
		setTimeout(function() {resync(state, connection)}, 2500)
	}
}
