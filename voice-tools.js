/* Real-time speech character controls for the Sorting Hat browser editor. */
(function(){
 'use strict';
 if(document.documentElement.dataset.pages!=='1')return;
 const select=document.getElementById('voicePreset');
 const bass=document.getElementById('voiceBass');
 const value=document.getElementById('voiceBassValue');
 const info=document.getElementById('voiceStatus');
 const audio=document.getElementById('audio');
 if(!select||!bass||!audio||!window.HatVoiceCharacter)return;
 const key='sorting-hat-voice-character-v1';
 const defaults=window.HatVoiceCharacter.DEFAULTS;
 let saved=defaults;
 try{saved=JSON.parse(localStorage.getItem(key))||defaults}catch(e){}
 let current=window.HatVoiceCharacter.settings(saved);
 select.value=current.preset;bass.value=current.bass;value.textContent=current.bass+'%';
 let graph=null;
 function persist(){
  try{localStorage.setItem(key,JSON.stringify(current))}catch(e){}
 }
 function ensureGraph(){
  if(graph)return graph;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx)throw Error('This browser cannot process audio in real time');
  audioContext||=new Ctx();
  // Exactly one MediaElementAudioSourceNode can be attached to an <audio> element.
  const source=audioContext.createMediaElementSource(audio);
  graph=window.HatVoiceCharacter.createGraph(audioContext,source,audioContext.destination,current);
  return graph;
 }
 function arm(){
  try{
   ensureGraph();
   audioContext.resume().catch(e=>{info.textContent='Audio processing paused: '+e.message});
  }catch(e){
   info.textContent='Live preview unavailable: '+(e?.message||e);
   console.error('Voice Character preview:',e);
  }
 }
 function update(){
  current=window.HatVoiceCharacter.settings({preset:select.value,bass:Number(bass.value)});
  value.textContent=current.bass+'%';
  persist();
  try{if(graph){graph.set(current);audioContext.resume().catch(()=>{})}}catch(e){console.warn('EQ update failed',e)}
  info.textContent=(current.preset==='deep'?'Warm and resonant':current.preset==='ancient'?'Gritty, textured presence':'Clear and balanced')+
   ' · Bass harmonics '+current.bass+'% · The Feather WAV export uses these settings.';
 }
 window.getVoiceSettings=()=>({...current});
 select.addEventListener('change',()=>{arm();update()});
 bass.addEventListener('input',()=>{arm();update()});
 document.getElementById('playBtn')?.addEventListener('click',arm,true);
 audio.addEventListener('play',arm);
 update();
})();
