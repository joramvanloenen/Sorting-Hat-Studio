/* Feather ZIP export: all recordings in library order, no empty placeholders. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {TextEncoder}=require('node:util');
const converterJs=fs.readFileSync('audio-converter.js','utf8');
const exporterJs=fs.readFileSync('feather-export.js','utf8');
const ctx={window:{},Uint8Array,Float32Array,DataView,Blob};
vm.runInNewContext(converterJs,ctx);
const wav=ctx.window.HatAudioConvert;
const pcm=new Float32Array(22050);
for(let i=0;i<pcm.length;i++)pcm[i]=0.18*Math.sin(Math.PI*2*440*i/22050);
const bytes=wav.encodeWav16(pcm,22050);

function clip(id,title,audio){
 return {id,title,duration:1,audio,
  tracks:{jaw:[{t:0,v:.1,ease:'linear'}],brow:[{t:0,v:.5,ease:'smooth'}]}};
}
const first=clip('import_first','First recording','import_first.mp3');
const blank=clip('empty','Empty placeholder',null);
const second=clip('import_second','Second recording','import_second.mp3');
const button={textContent:'Export Feather',disabled:false,
 addEventListener:(type,cb)=>{if(type==='click')button.run=cb}};
const quality={value:'22050'},voice={preset:'deep',bass:35};
const document={documentElement:{dataset:{pages:'1'}},getElementById:id=>
 id==='exportFeatherBtn'?button:id==='wavQuality'?quality:null};
let converted=0,download=null,feedback='';
const sourceKeys=new Set(['source:import_first','source:import_second']);
const context={document,window:{getVoiceSettings:()=>voice,HatAudioConvert:{
 readWaveHeader:wav.readWaveHeader,assertRate:wav.assertRate,
 convertBlob:async(blob,options)=>{
  converted++;
  assert.equal(options.sampleRate,22050);
  assert.equal(options.voice.preset,'deep');
  assert.equal(options.voice.bass,35);
  return {bytes};
 }
}},TextEncoder,Uint8Array,Uint32Array,DataView,Blob,
 state:{project:{clips:[first,blank,second]},clip:first,dirty:false,settings:{
  jaw:{rest:0,min_us:1200,max_us:1750,invert:false},
  brow:{rest:.5,min_us:1200,max_us:1750,invert:false}
 }},
 storedAudio:async key=>sourceKeys.has(key)?
  new Blob([Uint8Array.from([73,68,51,0,0,0])],{type:'audio/mpeg'}):null,
 fetch:async path=>({ok:true,text:async()=>path.endsWith('config.json')?
  JSON.stringify({jaw:{pin:'D4'},brow:{pin:'D5'},clip_id:'legacy'}):'print("ready")'}),
 saveClip:async()=>{},toast:s=>{feedback=s},downloadFile:(name,blob)=>{download={name,blob}},
 console};
vm.runInNewContext(exporterJs,context);
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
 assert(download,'Expected a ZIP archive');
 assert.equal(download.name,'Sorting-Hat-Feather-RP2040.zip');
 const entries=archiveEntries(new Uint8Array(await download.blob.arrayBuffer()));
 for(const id of ['import_first','import_second']){
  assert(entries['audio/'+id+'.wav'],'Missing WAV '+id);
  assert(entries['motion/'+id+'.json'],'Missing motion '+id);
  assert.equal(wav.readWaveHeader(entries['audio/'+id+'.wav']).valid,true);
  assert(!entries['audio/'+id+'.mp3'],'Original MP3 should not pass through');
 }
 assert(!entries['audio/empty.wav'],'Must skip audio-free placeholder');
 assert(!entries['motion/empty.json'],'Must skip audio-free placeholder motion');
 const project=JSON.parse(Buffer.from(entries['project.json']).toString());
 assert.deepEqual(project.clips.map(c=>c.id),['import_first','import_second']);
 assert.deepEqual(project.clips.map(c=>c.audio),
  ['audio/import_first.wav','audio/import_second.wav']);
 assert.equal(project.voiceCharacter.preset,'deep');
 assert.equal(project.voiceCharacter.bass,35);
 assert(!Object.hasOwn(JSON.parse(Buffer.from(entries['config.json']).toString()),'clip_id'),
  'Old selected-clip config must be removed');
 assert.equal(converted,2);
 assert.match(feedback,/2 recordings in list order/);

 first.audio=null;
 second.audio=null;
 download=null;feedback='';
 await button.run();
 assert.equal(download,null,'Empty library must not export a misleading ZIP');
 assert.match(feedback,/No performances contain audio/);
 console.log('Feather ZIP integration: ALL audio, order, keyframes, WAV, legacy config and empty library — passed');
})().catch(err=>{console.error(err);process.exitCode=1});
