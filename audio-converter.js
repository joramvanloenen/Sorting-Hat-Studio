/* Sorting Hat Studio — local, dependency-free audio conversion for CircuitPython.
 * PCM16 mono WAV; decoded and resampled entirely in the browser.
 * The player can read these WAV files without MP3 codec/bitrate compatibility issues.
 */
(function(root){
 'use strict';
 const SUPPORTED_RATES=[16000,22050,32000];
 const DEFAULT_RATE=22050;
 function assertRate(rate){
  rate=Number(rate);
  if(!SUPPORTED_RATES.includes(rate))throw Error('Select 16, 22.05 or 32 kHz PCM WAV');
  return rate;
 }
 function readWaveHeader(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(b.length<44)return null;
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const tag=(at,s)=>s.split('').every((c,i)=>b[at+i]===c.charCodeAt(0));
  if(!tag(0,'RIFF')||!tag(8,'WAVE'))return null;
  let pos=12,fmt=null,dataBytes=0;
  while(pos+8<=b.length) {
   const size=view.getUint32(pos+4,true);
   if(size>b.length-pos-8)break;
   if(tag(pos,'fmt ')&&size>=16){
    fmt={codec:view.getUint16(pos+8,true),channels:view.getUint16(pos+10,true),
      rate:view.getUint32(pos+12,true),bits:view.getUint16(pos+22,true)};
   }
   if(tag(pos,'data')){dataBytes=size;break}
   pos+=8+size+(size&1);
  }
  return fmt?Object.assign(fmt,{dataBytes,valid:fmt.codec===1&&fmt.channels===1&&fmt.bits===16&&dataBytes>0}):null;
 }
 function stats(samples){
  let peak=0,sum=0,sumSq=0;
  const len=samples.length;
  for(let i=0;i<len;i++){
   const x=Number.isFinite(samples[i])?samples[i]:0;
   peak=Math.max(peak,Math.abs(x));
   sum+=x;sumSq+=x*x;
  }
  const mean=sum/Math.max(1,len);
  return {peak,rms:Math.sqrt(Math.max(0,sumSq/Math.max(1,len)-mean*mean)),dc:mean};
 }
 function normalize(samples,opts={}){
  const data=new Float32Array(samples.length);
  const measured=stats(samples);
  if(measured.peak<.0001||measured.rms<.00003)
   throw Error('This recording is silent or extremely quiet. Check the original audio before exporting.');
  // Remove DC offset, then choose a comfortable voice level without clipping or
  // amplifying very quiet recordings beyond +18 dB (which can amplify hiss).
  let peak=0,energy=0;
  for(let i=0;i<samples.length;i++){
   const x=(Number.isFinite(samples[i])?samples[i]:0)-measured.dc;
   peak=Math.max(peak,Math.abs(x));energy+=x*x;
  }
  const rms=Math.sqrt(energy/Math.max(1,samples.length));
  const headroom=.84; // ~-1.5 dBFS peak, avoiding distorted speaker output.
  const targetRms=.17; // speech-friendly nominal level
  const gain=Math.max(.05,Math.min(7.9,targetRms/Math.max(.00001,rms),headroom/Math.max(.00001,peak)));
  const fade=Math.max(1,Math.min(samples.length>>1,Math.round((opts.sampleRate||DEFAULT_RATE)*.004)));
  for(let i=0;i<samples.length;i++){
   let x=((Number.isFinite(samples[i])?samples[i]:0)-measured.dc)*gain;
   if(i<fade)x*=i/fade;
   if(i>=samples.length-fade)x*=(samples.length-1-i)/fade;
   data[i]=Math.max(-headroom,Math.min(headroom,x));
  }
  return {samples:data,original:measured,converted:stats(data),gain};
 }
 function encodeWav16(samples,sampleRate){
  sampleRate=assertRate(sampleRate);
  if(!samples.length)throw Error('No samples to encode');
  const byteCount=44+samples.length*2;
  if(byteCount>0xFFFFFFFF)throw Error('WAV file exceeds format limit');
  const bytes=new Uint8Array(byteCount),view=new DataView(bytes.buffer);
  const ascii=(at,s)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i)};
  ascii(0,'RIFF');view.setUint32(4,byteCount-8,true);
  ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);
  ascii(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){
   const x=Math.max(-1,Math.min(1,Number.isFinite(samples[i])?samples[i]:0));
   view.setInt16(44+i*2,Math.round(x<0?x*32768:x*32767),true);
  }
  return bytes;
 }
 async function convertBuffer(decoded,options={}){
  if(!decoded||!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>600)
   throw Error('Recording must be between 0 and 10 minutes long');
  const rate=assertRate(options.sampleRate||DEFAULT_RATE);
  const length=Math.max(1,Math.round(decoded.duration*rate));
  const Offline=root.OfflineAudioContext||root.webkitOfflineAudioContext;
  if(!Offline)throw Error('Offline audio conversion is not supported by this browser');
  const context=new Offline(1,length,rate);
  const source=context.createBufferSource();
  source.buffer=decoded;
  // Browser mixes stereo to a mono channel and resamples using its built-in
  // high-quality resampler. Light compression tames speech peaks.
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-25;
  compressor.knee.value=15;
  compressor.ratio.value=2.5;
  compressor.attack.value=.005;
  compressor.release.value=.18;
  source.connect(compressor);
  compressor.connect(context.destination);
  source.start(0);
  const rendered=await context.startRendering();
  const adjusted=normalize(rendered.getChannelData(0),{sampleRate:rate});
  const bytes=encodeWav16(adjusted.samples,rate);
  const header=readWaveHeader(bytes);
  if(!header?.valid||header.rate!==rate)throw Error('Generated audio failed PCM WAV validation');
  const blob=new Blob([bytes],{type:'audio/wav'});
  return {
   blob,bytes,
   details:{sampleRate:rate,channels:1,bitDepth:16,codec:'PCM WAV',
    duration:rendered.duration,bytes:bytes.byteLength,
    sourceRate:decoded.sampleRate,sourceChannels:decoded.numberOfChannels,
    sourcePeak:adjusted.original.peak,peak:adjusted.converted.peak,
    rms:adjusted.converted.rms,gain:adjusted.gain}
  };
 }
 async function convertBlob(blob,options={}){
  if(!blob)throw Error('No audio is stored for this performance. Import it again.');
  const Audio=root.AudioContext||root.webkitAudioContext;
  if(!Audio)throw Error('This browser cannot decode audio files');
  const ctx=new Audio();
  let decoded;
  try{decoded=await ctx.decodeAudioData(await blob.arrayBuffer())}
  catch(e){throw Error('The audio file cannot be decoded: '+(e?.message||e))}
  finally{await ctx.close()}
  return convertBuffer(decoded,options);
 }
 root.HatAudioConvert={convertBlob,convertBuffer,readWaveHeader,encodeWav16,
  stats,normalize,DEFAULT_RATE,SUPPORTED_RATES,assertRate};
})(typeof window!=='undefined'?window:globalThis);
