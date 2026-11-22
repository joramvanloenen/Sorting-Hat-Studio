/* Integration test: Feather export must contain a validated WAV, not the source MP3. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {TextEncoder}=require('node:util');
const converterJs=fs.readFileSync('audio-converter.js','utf8');
const exporterJs=fs.readFileSync('feather-export.js','utf8');
const audioContext={window:{},Uint8Array,Float32Array,DataView,Blob};
vm.runInNewContext(converterJs,audioContext);
const wav=audioContext.window.HatAudioConvert;
const pcm=new Float32Array(22050);
for(let i=0;i<pcm.length;i++)pcm[i]=0.18*Math.sin(Math.PI*2*440*i/22050);
const bytes=wav.encodeWav16(pcm,22050);
const clip={id:'import_voice',title:'My recording',duration:1,audio:'import_voice.mp3',
 tracks:{jaw:[{t:0,v:0,ease:'linear'}],brow:[{t:0,v:.5,ease:'smooth'}]}};
const button={textContent:'Export Feather',disabled:false,addEventListener:(event,cb)=>{if(event==='click')button.run=cb}};
const quality={value:'22050'},onlySelected={checked:true},voice={preset:'deep',bass:35};
const dom={documentElement:{dataset:{pages:'1'}},getElementById:id=>
 id==='exportFeatherBtn'?button:id==='wavQuality'?quality:id==='featherSelectedOnly'?onlySelected:null};
let converted=0,download=null,feedback='';
const wrapped={document:dom,window:{getVoiceSettings:()=>voice,HatAudioConvert:{
 readWaveHeader:wav.readWaveHeader,assertRate:wav.assertRate,
 convertBlob:async(blob,opts)=>{converted++;assert.equal(opts.sampleRate,22050);assert.equal(opts.voice.preset,'deep');assert.equal(opts.voice.bass,35);return {bytes}}
}},TextEncoder,Uint8Array,Uint32Array,DataView,Blob,
 state:{project:{clips:[clip]},clip,dirty:false,settings:{jaw:{rest:0,min_us:1200,max_us:1750,invert:false},brow:{rest:.5,min_us:1200,max_us:1750,invert:false}}},
 storedAudio:async key=>key==='source:import_voice'?new Blob([Uint8Array.from([73,68,51,0,0,0])],{type:'audio/mpeg'}):null,
 fetch:async path=>({ok:true,text:async()=>path.endsWith('config.json')?JSON.stringify({jaw:{pin:'D4'},brow:{pin:'D5'}}):'print("ready")'}),
 saveClip:async()=>{},toast:s=>{feedback=s;},downloadFile:(name,blob)=>{download={name,blob};},
 console};
vm.runInNewContext(exporterJs,wrapped);
assert.equal(typeof button.run,'function');
function archiveEntries(data){
 const entries={};const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 let pos=0;
 while(pos+30<=data.byteLength&&view.getUint32(pos,true)===0x04034b50){
  const size=view.getUint32(pos+18,true),n=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true);
  const name=Buffer.from(data.subarray(pos+30,pos+30+n)).toString('utf8');
  entries[name]=data.subarray(pos+30+n+extra,pos+30+n+extra+size);
  pos+=30+n+extra+size;
 }
 return entries;
}
(async()=>{
 await button.run();
 assert(download,'export should produce a ZIP');
 assert.equal(download.name,'Sorting-Hat-Feather-RP2040.zip');
 const data=new Uint8Array(await download.blob.arrayBuffer());
 const entries=archiveEntries(data);
 assert(!entries['audio/import_voice.mp3'],'Original MP3 must not pass through');
 assert(entries['audio/import_voice.wav'],'Missing normalized WAV');
 assert.equal(wav.readWaveHeader(entries['audio/import_voice.wav']).valid,true);
 const project=JSON.parse(Buffer.from(entries['project.json']).toString());
 assert.equal(project.clips.length,1);
 assert.equal(project.clips[0].audio,'audio/import_voice.wav');
 assert.equal(project.voiceCharacter.preset,'deep');
 assert.equal(project.voiceCharacter.bass,35);
 assert.equal(JSON.parse(Buffer.from(entries['config.json']).toString()).clip_id,'import_voice');
 assert.equal(converted,1);
 assert.match(feedback,/PCM16 mono WAV/);
 clip.audio=null;download=null;feedback='';
 await button.run();
 assert.equal(download,null,'Do not export a silent/empty performance');
 assert.match(feedback,/uploaded audio|has no audio/i);
 console.log('Feather ZIP integration: WAV only, manifest, selected clip, missing audio failure — passed');
})().catch(e=>{console.error(e);process.exitCode=1});
