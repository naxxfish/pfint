PathfinderPC Server Interface
=====

PathfinderPC Interface for Node.js

This package allows you to interact with [PathfinderPC Server](www.pathfinderpc.com).  

It keeps an in-memory database ([nedb](https://github.com/louischatriot/nedb)) to keep track of the state - so don't feel bad about querying it lots, it won't hit Pathfinder.  

### Installation

Do this to get it into your node project:

    npm install pfint --save

### Usage

Require it, create a new one.  

    var PFInterface = require('pfint')
    var pfint = new PFInterface();
    pfint.sync({
		'user' : "Pathfinder_User",
		'password' : "Pathfinder_Password",
		'host' : "localhost",
		'port' : 9500
	})

PFInt gives off lots of events and things.  It can also be queried.  

### Methods
There are a coupe of methods you can use 
#### sync(options)
This is the method which starts up the connection.  

    {
		'user' : "Pathfinder_User",
		'password' : "Pathfinder_Password",
		'host' : "localhost",
		'port' : 9500
    }

#### find(query, cb)
This is basically a passthrough for [nedb](https://github.com/louischatriot/nedb).find.  

cb(err, item)

There are various itemTypes that can be queried for.  

* source
* destination
* router
* protocoltranslator
* routes

A bit like this:

    pfint.find({'itemType' : 'protocoltranslator'}, function(err, pts)
    {
        response.end(JSON.stringify(pts))		
    })

#### findOne(query, cb)
The same as the above, except only one result gets returned.

### Events
You can connect to events in the normal way:

    pfint.on('debug', function (message) {
        console.log(message)
    })

#### debug (message)
Debugging notes come out at various useful points.  

#### connected
Is raised when we are connected to PathfinderPC

#### memorySlot (slot)
Is raised when a memory slot is updated

#### route (route)
Is raised when a route is created

#### error (message)
Raised when an error occurs (no, really?)

#### gpi (state) ***DRAFT***
Raised when a GPI state changes 

### Credits
So far, all done by me (Chris)

Like it? Send me some Bitcoins? 1GTw3bJ5UB7g2upzzvXarJ9VZX3gREdpgG
![1GTw3bJ5UB7g2upzzvXarJ9VZX3gREdpgG](http://naxxfish.files.wordpress.com/2014/02/desktop_wallet_code.png)
