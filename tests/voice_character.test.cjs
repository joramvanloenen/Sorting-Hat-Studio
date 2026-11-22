/* Voice presets and harmonic DSP routing validation. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('voice-character.js','utf8');
const scope={window:{},Float32Array,Math};
vm.runInNewContext(code,scope);
const v=scope.window.HatVoiceCharacter;
assert.equal(v.DEFAULTS.preset,'deep');assert.equal(v.DEFAULTS.bass,35);
assert.equal(v.settings({preset:'other',bass:500}).preset,'deep');
assert.equal(v.settings({preset:'ancient',bass:-30}).bass,0);
assert.equal(Object.keys(v.PRESETS).length,3);
class FakeParam{
 constructor(){this.value=0}
 setTargetAtTime(value){this.value=value}
}
class FakeNode{
 constructor(name){this.name=name;this.connections=[];this.gain=new FakeParam();this.frequency=new FakeParam();this.Q=new FakeParam();
 this.threshold=new FakeParam();this.knee=new FakeParam();this.ratio=new FakeParam();this.attack=new FakeParam();this.release=new FakeParam()}
 connect(next){this.connections.push(next)}
 disconnect(next){this.connections=this.connections.filter(x=>next?x!==next:false)}
}
const created=[];
const context={currentTime:0,
 createBiquadFilter(){const n=new FakeNode('eq');created.push(n);return n},
 createDynamicsCompressor(){const n=new FakeNode('compressor');created.push(n);return n},
 createGain(){const n=new FakeNode('gain');created.push(n);return n},
 createWaveShaper(){const n=new FakeNode('harmonics');created.push(n);return n}
};
const input=new FakeNode('input'),output=new FakeNode('output');
const graph=v.createGraph(context,input,output,{preset:'deep',bass:35});
assert.equal(created.filter(x=>x.name==='harmonics').length,1);
const harmonic=created.find(x=>x.name==='harmonics');
assert.equal(harmonic.curve.length,2048);
assert(harmonic.curve[1400] > 0);
assert(input.connections.length>0);
const wet=created.find(x=>x.name==='gain'&&x.gain.value>0&&x.gain.value<.6);
assert(wet,'Bass harmonics mix must be active at 35%');
graph.set({preset:'natural',bass:0});assert.equal(wet.gain.value,0);
graph.set({preset:'ancient',bass:100});assert(wet.gain.value>.5);
graph.disconnect();assert.equal(input.connections.length,0);
console.log('Voice presets: Natural, Deep, Ancient + bass 35% harmonic signal flow — passed');
