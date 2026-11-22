/* Sorting Hat Studio — one shared audio signal chain for live preview and WAV export.
 * Adds psychoacoustic low-frequency harmonics appropriate for miniature speakers.
 * This changes timbre and bass perception, not fundamental pitch.
 */
(function(root){
 'use strict';
 const DEFAULTS=Object.freeze({preset:'deep',bass:35});
 const PRESETS=Object.freeze({
  natural:Object.freeze({hp:110,warmth:0,box:0,presence:.7,compression:2.0}),
  deep:Object.freeze({hp:135,warmth:3.2,box:-1.7,presence:1.3,compression:2.6}),
  ancient:Object.freeze({hp:125,warmth:4.1,box:-2.5,presence:1.8,compression:3.4})
 });
 function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,Number(v)||0))}
 function settings(value){
  const config=value||{};
  const preset=Object.prototype.hasOwnProperty.call(PRESETS,config.preset)?config.preset:DEFAULTS.preset;
  return {preset,bass:clamp(config.bass===undefined?DEFAULTS.bass:config.bass,0,100)};
 }
 function saturationCurve(){
  const count=2048,curve=new Float32Array(count);
  for(let i=0;i<count;i++){
   const x=(i/(count-1))*2-1;
   curve[i]=Math.tanh(3*x)/Math.tanh(3);
  }
  return curve;
 }
 function createGraph(context,input,destination,value){
  if(!context||!input||!destination)throw Error('Voice chain requires an audio context and input/output');
  function filter(type,freq,Q){
   const f=context.createBiquadFilter();f.type=type;f.frequency.value=freq;
   if(Q!==undefined)f.Q.value=Q;return f;
  }
  const highpass=filter('highpass',135,.707);
  const warmth=filter('peaking',290,.85);
  const boxcut=filter('peaking',1100,.85);
  const presence=filter('peaking',2600,.9);
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-25;compressor.knee.value=16;
  compressor.attack.value=.007;compressor.release.value=.18;
  const dry=context.createGain();dry.gain.value=1;
  const master=context.createGain();master.gain.value=.88;
  // Harmonics from a narrow low-frequency voice band help tiny drivers convey
  // deep voices without injecting inaudible, distortion-causing sub-bass.
  const lowBand=filter('bandpass',180,.8);
  const wave=context.createWaveShaper();wave.curve=saturationCurve();wave.oversample='2x';
  const harmonicHP=filter('highpass',215,.707);
  const wet=context.createGain();wet.gain.value=0;
  input.connect(highpass);highpass.connect(warmth);warmth.connect(boxcut);
  boxcut.connect(presence);presence.connect(compressor);
  compressor.connect(dry);dry.connect(master);
  highpass.connect(lowBand);lowBand.connect(wave);wave.connect(harmonicHP);
  harmonicHP.connect(wet);wet.connect(master);master.connect(destination);
  const nodes=[highpass,warmth,boxcut,presence,compressor,dry,master,lowBand,wave,harmonicHP,wet];
  function param(p,value){
   if(typeof p.setTargetAtTime==='function'&&typeof context.currentTime==='number')
    p.setTargetAtTime(value,context.currentTime,.025);
   else p.value=value;
  }
  function set(next){
   const cfg=settings(next),p=PRESETS[cfg.preset];
   param(highpass.frequency,p.hp);
   param(warmth.frequency,280);
   param(warmth.gain,p.warmth);
   param(boxcut.frequency,1100);
   param(boxcut.gain,p.box);
   param(presence.frequency,2500);
   param(presence.gain,p.presence);
   param(compressor.ratio,p.compression);
   // 35% => gentle audible reinforcement without overdriving 1W 8-ohm speaker.
   const mix=.58*Math.pow(cfg.bass/100,1.15);
   param(wet.gain,mix);
   return cfg;
  }
  set(value||DEFAULTS);
  return {set,disconnect:()=>{
   try{input.disconnect(highpass)}catch(e){}
   for(const node of nodes){try{node.disconnect()}catch(e){}}
  }};
 }
 root.HatVoiceCharacter={DEFAULTS,PRESETS,settings,createGraph};
})(typeof window!=='undefined'?window:globalThis);
