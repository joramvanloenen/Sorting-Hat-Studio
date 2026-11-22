/* Sorting Hat Studio — convert, audition and download CircuitPython-safe audio. */
(function(){
 'use strict';
 if(document.documentElement.dataset.pages!=='1')return;
 const $=id=>document.getElementById(id);
 const convertButton=$('convertAudioBtn');
 const downloadButton=$('downloadWavBtn');
 const format=$('audioConvertInfo');
 const quality=$('wavQuality');
 if(!convertButton||!downloadButton||!format||!quality)return;
 let busy=false;
 const size=bytes=>(bytes/1048576).toFixed(2)+' MB';
 const rate=()=>Number(quality.value)||22050;
 function status(msg,type='normal'){
  format.textContent=msg;
  format.dataset.status=type;
 }
 function refresh(){
  const clip=state.clip;
  const can=!!clip?.audio;
  convertButton.disabled=!can||busy;
  downloadButton.disabled=!can||busy;
  if(!busy&&(!clip||!can))status('No audio in this performance. Import a recording to enable conversion.');
 }
 window.refreshAudioTools=refresh;
 window.updateAudioInfo=(blob,decoded,error)=>{
  refresh();
  if(error){status('Audio cannot be played: '+error,'error');return}
  if(!decoded)return;
  const fmt=blob?.type==='audio/wav'?'WAV':'Audio';
  status(fmt+' loaded · '+(decoded.sampleRate/1000).toFixed(2)+' kHz · '+
   decoded.numberOfChannels+' channel'+(decoded.numberOfChannels===1?'':'s')+
   ' · '+decoded.duration.toFixed(2)+' s'+(blob?' · '+size(blob.size):'')+
   '. Use Convert & listen to verify the Feather-safe WAV.');
 };
 async function getSource(clip) {
  const original=await storedAudio('source:'+clip.id);
  if(original)return original;
  const current=await storedAudio(clip.id);
  if(current)return current;
  if(clip.id.startsWith('import_'))throw Error('The recording is missing from browser storage. Re-import the original audio.');
  const res=await fetch('./audio/'+encodeURIComponent(clip.id)+'.mp3');
  if(!res.ok)throw Error('The original recording is unavailable. Import your audio again.');
  return await res.blob();
 }
 async function run({download=false}={}){
  if(busy)return;
  if(!state.clip?.audio){status('Import a recording first.','error');return}
  const clip=state.clip,clipid=clip.id;
  busy=true;refresh();
  const before=convertButton.textContent;
  convertButton.textContent=download?'Converting…':'Converting & checking…';
  try {
   const original=await getSource(clip);
   status('Decoding, resampling and normalizing…');
   const result=await window.HatAudioConvert.convertBlob(original,{sampleRate:rate()});
   if(state.clip?.id!==clipid)throw Error('Selected performance changed; retry conversion');
   const h=window.HatAudioConvert.readWaveHeader(result.bytes);
   if(!h?.valid)throw Error('Converted audio did not pass WAV validation');
   const metadata=(rate()/1000).toFixed(2)+' kHz · PCM16 mono · '+
     result.details.duration.toFixed(2)+' s · '+size(result.bytes.byteLength);
   if(download){
    downloadFile(clipid+'.wav',result.blob);
    status('Compatible WAV downloaded · '+metadata,'ok');
    toast('Downloaded CircuitPython-compatible '+metadata);
    return;
   }
   // Keep the untouched source for future quality changes and recovery.
   if(!await storedAudio('source:'+clipid))
    await storedAudio('source:'+clipid,original);
   const persisted=await storedAudio(clipid,result.blob);
   if(persisted===null)throw Error('Browser storage blocked/full. Download the WAV instead, or free site storage.');
   stopPlayback();
   state.clip.audio=clipid+'.wav';
   state.clip.duration=Math.round(result.details.duration*1000)/1000;
   markDirty();
   await saveClip();
   await pagesLoadAudio();
   status('Ready — '+metadata+' · normalization '+(20*Math.log10(result.details.gain)).toFixed(1)+' dB','ok');
   window.setImportStatus?.('ready','Normalized '+metadata+'. Press play to audition.');
   if(state.clip?.id===clipid){
    state.time=0;
    await togglePlayback();
    if(state.playing)toast('Playing converted WAV · '+metadata);
   }
  }catch(err){
   console.error('Audio converter failed:',err);
   status('Conversion failed: '+(err?.message||err),'error');
   toast('Conversion failed: '+(err?.message||err));
  }finally{
   busy=false;
   convertButton.textContent=before;
   refresh();
  }
 }
 convertButton.addEventListener('click',()=>run({download:false}));
 downloadButton.addEventListener('click',()=>run({download:true}));
 quality.addEventListener('change',()=>{if(state.clip?.audio)status('Target WAV: '+(rate()/1000).toFixed(2)+' kHz, 16-bit mono. Convert to hear this quality.')});
 refresh();
})();
