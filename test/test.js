var should = require('should')
var randomstring = require('randomstring')

describe('PFInterface', function() {
	var pfint = require('../index.js')
	var pfinterface = new pfint();
	var options = {
		user : 'PFInterface',
		password : 'PFInterface',
		host : '127.0.0.1',
		port : 9500
	}
	it('should connect to a PathfinderPC Server and emit a connected event',function(done) {
		this.timeout(1200)
		pfinterface.sync(options)
		pfinterface.on('connected', function() { 
			done()
		})
	})
	it('should set a memory slot', function (done) {
		this.timeout(1200)
		var randomValue = randomstring.generate();
		pfinterface.setMemorySlot("mochatest1",randomValue, function(err, slot) {
			//{"itemType":"memoryslot","number":"0","name":"mochatest","value":"mochatest"
			slot.itemType.should.equal("memoryslot")
			slot.name.should.equal("mochatest1")
			slot.value.should.equal(randomValue)
			done()
		})
	})
	it('should find one memory slot', function (done) {
		this.timeout(1200)
		var randomValue = randomstring.generate();
		pfinterface.setMemorySlot("mochatest2",randomValue, function(err, slot) {
			//{"itemType":"memoryslot","number":"0","name":"mochatest","value":"mochatest"
			pfinterface.findOne({'itemType':'memoryslot','name':'mochatest2'},function (err, memoryslot)
			{
				memoryslot.should.not.be.Array()
				memoryslot.name.should.equal("mochatest2")
				memoryslot.value.should.equal(randomValue)
				done()
			})
			
		})		
	})
	it('should find several memory slots', function (done) {
		this.timeout(1200)
		var randomValue = randomstring.generate();
		pfinterface.setMemorySlot("mochatest2",randomValue, function(err, slot) {
			//{"itemType":"memoryslot","number":"0","name":"mochatest","value":"mochatest"
			pfinterface.find({'itemType':'memoryslot'},function (err, memoryslots)
			{
				memoryslots.should.be.Array()
				done()
			})
			
		})		
	})
})