/* Sorting Hat Studio — browser motion editor. No build tools or external libraries. */
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a=0, b=1) => Math.min(b, Math.max(a, Number(v)));
const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${String(Math.floor(s%1*100)).padStart(2,'0')}`;
const state = {project:null,settings:null,clip:null,selected:null,time:0,playing:false,startAt:0,fromTime:0,zoom:128,peaks:null,audioBuffer:null,hardware:false,busy:false,drag:null,saving:false,dirty:false,saveTimer:null,prevPreviewAt:0,loadToken:0};
const audio = $('audio');
const canvas = $('timeline');
const ctx = canvas.getContext('2d');
let audioContext;

async function api(path, method='GET', data=null) {
  const opt={method};
  if(data!==null){opt.headers={'Content-Type':'application/json'};opt.body=JSON.stringify(data)}
  const res=await fetch(path,opt);
  let json;try{json=await res.json()}catch{throw Error(`HTTP ${res.status}`)}
  if(!res.ok)throw Error(json.error||`HTTP ${res.status}`);
  return json;
}
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4200)}
function getClip(id){return state.project.clips.find(c=>c.id===id)}
function ease(s,type){return type==='hold'?0:type==='smooth'?s*s*(3-2*s):s}
function evalKeys(keys,t,rest=0){if(!keys.length)return rest;if(t<=keys[0].t)return keys[0].v;if(t>=keys.at(-1).t)return keys.at(-1).v;let l=0,r=keys.length-1;while(r-l>1){const m=(l+r)>>1;if(keys[m].t<=t)l=m;else r=m}const a=keys[l],b=keys[r];const u=(t-a.t)/(b.t-a.t||1);return a.v+(b.v-a.v)*ease(u,a.ease)}
function values(t){return {jaw:evalKeys(state.clip.tracks.jaw,t,0),brow:evalKeys(state.clip.tracks.brow,t,.5)}}
function makeClipList(){
 const icons=['◈','≋','♜','◉','◇','✧'];
 $('clipList').innerHTML='';
 if($('clipCount'))$('clipCount').textContent=String(state.project.clips.length).padStart(2,'0')+' CLIP'+(state.project.clips.length===1?'':'S');
 state.project.clips.forEach((clip,i)=>{
  const button=document.createElement('button');button.className='clip'+(clip.id===state.clip?.id?' active':'');
  button.innerHTML=`<span class="clip-icon">${icons[i]||'✦'}</span><div><div class="clip-title"></div><div class="clip-meta"></div></div>`;
  button.querySelector('.clip-title').textContent=clip.title;
  button.querySelector('.clip-meta').textContent=`${clip.duration.toFixed(1)}s · ${clip.audio?'audio ready':'no audio'}`;
  button.addEventListener('click',()=>selectClip(clip.id));$('clipList').append(button);
 });
}
async function selectClip(id){
 if(state.clip?.id===id)return;
 stopPlayback();if(state.dirty)await saveClip();
 state.clip=getClip(id);state.selected=null;state.time=0;state.peaks=null;state.audioBuffer=null;
 makeClipList();$('clipTitle').textContent=state.clip.title;
 $('clipDescription').textContent=state.clip.audio?'Audio loaded · animation editable':'No recorded audio yet · motion preview available';
 $('totalTime').textContent=fmt(state.clip.duration);
 $('trackStats').textContent=`Jaw: ${state.clip.tracks.jaw.length} keys · Brows: ${state.clip.tracks.brow.length} keys`;
 updateInspector();await loadAudio();render();
}
async function loadAudio(){
 const token=++state.loadToken;
 audio.pause();audio.removeAttribute('src');audio.load();
 if(!state.clip?.audio)return;
 audio.src=`/api/audio/${encodeURIComponent(state.clip.id)}?v=${Date.now()}`;audio.load();
 try{
  const res=await fetch(`/api/audio/${encodeURIComponent(state.clip.id)}?v=${Date.now()}`);
  if(!res.ok)throw Error('Cannot load audio');
  const buf=await res.arrayBuffer();
  audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
  const decoded=await audioContext.decodeAudioData(buf.slice(0));
  if(token!==state.loadToken)return;
  state.audioBuffer=decoded;state.peaks=calculatePeaks(decoded);
  render();
 }catch(e){if(token===state.loadToken)toast('Waveform not available: '+e.message)}
}
function calculatePeaks(buffer){
 const data=buffer.getChannelData(0), step=Math.max(1,Math.round(buffer.sampleRate*.008));
 const peaks=new Float32Array(Math.ceil(data.length/step));
 for(let i=0;i<peaks.length;i++){
  let sum=0;const end=Math.min(data.length,(i+1)*step),start=i*step;
  for(let k=start;k<end;k++)sum+=data[k]*data[k];
  peaks[i]=Math.sqrt(sum/Math.max(1,end-start));
 }
 return peaks;
}
function render(){
 if(!state.clip)return;
 const w=Math.max($('timelineScroll').clientWidth-2,Math.ceil(state.clip.duration*state.zoom)+80);
 const dpr=Math.min(window.devicePixelRatio||1,2);
 canvas.style.width=w+'px';canvas.style.height='308px';
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(308*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(308*dpr)}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,308);
 const tr=[{key:'jaw',top:110,bottom:196,color:'#d6a16e'},{key:'brow',top:210,bottom:296,color:'#8fadc4'}];
 ctx.fillStyle='#222126';ctx.fillRect(0,20,w,82);
 for(const track of tr){ctx.fillStyle=track.key==='jaw'?'#25211e':'#20242b';ctx.fillRect(0,track.top,w,track.bottom-track.top)}
 const step=state.zoom<85?2:state.zoom<170?1:.5;
 for(let t=0;t<=state.clip.duration;t+=step){
  const x=t*state.zoom+.5;ctx.beginPath();ctx.strokeStyle=Math.round(t/step)%2===0?'#ffffff16':'#ffffff0e';ctx.moveTo(x,0);ctx.lineTo(x,302);ctx.stroke();
  ctx.fillStyle='#8d8b91';ctx.font='10px ui-monospace, monospace';ctx.fillText(fmt(t).slice(0,5),x+5,13);
 }
 ctx.strokeStyle='#ffffff10';ctx.beginPath();ctx.moveTo(0,116);ctx.lineTo(w,102);ctx.moveTo(0,203);ctx.lineTo(w,203);ctx.stroke();
 if(state.peaks){
  const peaks=state.peaks;let max=.01;for(let i=0;i<peaks.length;i++)max=Math.max(max,peaks[i]);
  for(let x=0;x<Math.min(w,state.clip.duration*state.zoom);x+=2){
   const from=Math.floor(x/state.zoom/state.clip.duration*peaks.length),to=Math.max(from+1,Math.floor((x+2)/state.zoom/state.clip.duration*peaks.length));
   let v=0;for(let k=from;k<Math.min(to,peaks.length);k++)v=Math.max(v,peaks[k]);
   const a=35*Math.min(1,Math.pow(v/max,.67));
   ctx.strokeStyle='rgba(181,143,101,.7)';ctx.beginPath();ctx.moveTo(x,61-a);ctx.lineTo(x,61+a);ctx.stroke();
  }
 }else{ctx.fillStyle='#7f7776';ctx.font='11px system-ui';ctx.fillText('Import a voice recording to display waveform',190,61)}
 for(const track of tr){
  const top=track.top,bot=track.bottom,span=bot-top-24,y=v=>bot-12-v*span;
  for(let v=0;v<=1;v+=.25){ctx.strokeStyle='#ffffff10';ctx.beginPath();ctx.moveTo(0,y(v));ctx.lineTo(w,y(v));ctx.stroke()}
  const keys=state.clip.tracks[track.key];if(!keys.length)continue;
  ctx.beginPath();ctx.moveTo(0,y(evalKeys(keys,0)));
  const samples=Math.ceil(state.clip.duration*state.zoom/5);
  for(let s=1;s<=samples;s++){const time=s/samples*state.clip.duration;ctx.lineTo(time*state.zoom,y(evalKeys(keys,time)))}
  ctx.strokeStyle=track.color;ctx.lineWidth=2;ctx.stroke();ctx.lineWidth=1;
  keys.forEach((key,i)=>{
   const x=key.t*state.zoom,py=y(key.v),selected=state.selected?.channel===track.key&&state.selected.index===i;
   ctx.beginPath();ctx.arc(x,py,selected?6.5:4.4,0,Math.PI*2);ctx.fillStyle=selected?'#fff1ce':track.color;ctx.fill();
   ctx.lineWidth=selected?2:1;ctx.strokeStyle=selected?'#d0aa77':'#151619';ctx.stroke();ctx.lineWidth=1;
  });
 }
 const px=state.time*state.zoom;ctx.strokeStyle='#f0d6ae';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,302);ctx.stroke();ctx.fillStyle='#f0d6ae';ctx.beginPath();ctx.moveTo(px-6,0);ctx.lineTo(px+6,0);ctx.lineTo(px,9);ctx.fill();
}
function updateFace(){
 if(!state.clip)return;
 const {jaw,brow}=values(state.time);
 // Mouth opens vertically from the upper lip while the lower crease moves down.
 const gap=5+jaw*46;
 $('mouthDark').setAttribute('d',`M222 300 Q282 ${294-jaw*2} 349 299 Q318 ${302+gap*.55} 281 ${302+gap} Q244 ${302+gap*.8} 222 300Z`);
 $('lowerLip').setAttribute('d',`M222 302 Q281 ${306+gap} 349 301 Q315 ${323+gap} 278 ${320+gap} Q240 ${320+gap*.75} 222 302Z`);
 const shift=(.5-brow)*25;
 $('browsShape').setAttribute('transform',`translate(0 ${shift.toFixed(2)}) rotate(${((brow-.5)*-4).toFixed(2)} 280 225)`);
 $('jawReadout').textContent=Math.round(jaw*100)+'%';$('browReadout').textContent=Math.round(brow*100)+'%';
 $('currentTime').textContent=fmt(state.time);
 const now=performance.now();
 if($('livePreview').checked&&state.hardware&&!state.busy&&now-state.prevPreviewAt>60){
  state.prevPreviewAt=now;
  api('/api/preview','POST',{jaw,brow}).catch(()=>{});
 }
}
function markDirty(){
 state.dirty=true;$('saveState').textContent='● Unsaved changes';
 $('trackStats').textContent=`Jaw: ${state.clip.tracks.jaw.length} keys · Brows: ${state.clip.tracks.brow.length} keys`;
 clearTimeout(state.saveTimer);state.saveTimer=setTimeout(saveClip,850);
}
async function saveClip(){
 clearTimeout(state.saveTimer);
 if(!state.dirty||state.saving)return;
 state.saving=true;
 try{
  const saved=await api('/api/clip/'+state.clip.id,'POST',state.clip);
  const idx=state.project.clips.findIndex(c=>c.id===saved.id);
  if(idx>=0)state.project.clips[idx]=saved;
  state.clip=saved;state.dirty=false;$('saveState').textContent='✓ Saved to Pi';makeClipList();
 }catch(e){toast('Save failed: '+e.message);$('saveState').textContent='Save failed — retry'}
 finally{state.saving=false}
}
function selectKey(channel,index){state.selected=index===null?null:{channel,index};updateInspector();render()}
function selectedKey(){return state.selected?state.clip.tracks[state.selected.channel][state.selected.index]:null}
function updateInspector(){
 if(!state.clip)return;
 const key=selectedKey();
 $('selectedHint').textContent=key?'Adjust the selected keyframe. Changes are saved automatically.':'Click a keyframe on the timeline to edit it.';
 $('keyChannel').value=state.selected?.channel||'jaw';
 for(const k of ['keyTime','keyValue','keyEase'])$(k).disabled=!key;
 $('deleteKeyBtn').disabled=!key;
 if(key){$('keyTime').value=key.t.toFixed(2);$('keyValue').value=Math.round(key.v*100);$('keyEase').value=key.ease}
 else{$('keyTime').value='';$('keyValue').value='';$('keyEase').value='smooth'}
}
function changeSelected(property,value){
 const key=selectedKey();if(!key)return;
 if(property==='t'){key.t=clamp(value,0,state.clip.duration);const ch=state.selected.channel;const ref=key;state.clip.tracks[ch].sort((a,b)=>a.t-b.t);state.selected.index=state.clip.tracks[ch].indexOf(ref)}
 else if(property==='v')key.v=clamp(value);
 else key.ease=value;
 markDirty();updateInspector();render();
}
function laneAt(y){if(y>=110&&y<=196)return {channel:'jaw',top:110,bottom:196};if(y>=210&&y<=296)return {channel:'brow',top:210,bottom:296};return null}
function pointerPos(e){const b=canvas.getBoundingClientRect();return {x:(e.clientX-b.left),y:(e.clientY-b.top)}}
function keyFromPosition(x,y){
 const lane=laneAt(y);if(!lane)return null;
 const keys=state.clip.tracks[lane.channel];let best=null,d=12;
 keys.forEach((k,i)=>{const px=k.t*state.zoom,py=lane.bottom-12-k.v*(lane.bottom-lane.top-24);const dist=Math.hypot(x-px,y-py);if(dist<d){best={channel:lane.channel,index:i};d=dist}});return best;
}
function scrub(x){state.time=clamp(x/state.zoom,0,state.clip.duration);if(state.clip.audio){try{audio.currentTime=state.time}catch{}}state.fromTime=state.time;state.startAt=performance.now();updateFace();render()}
function stopPlayback(){state.playing=false;audio.pause();$('playBtn').textContent='▶'}
async function togglePlayback(){
 if(state.playing){stopPlayback();return}
 if(state.time>=state.clip.duration-.02)state.time=0;
 state.fromTime=state.time;state.startAt=performance.now();state.playing=true;$('playBtn').textContent='Ⅱ';
 if(state.clip.audio){
  try{audio.currentTime=state.time;audio.volume=Number($('previewVolume').value)/100;await audio.play()}
  catch(e){stopPlayback();toast('Cannot play audio: '+e.message)}
 }
}
function addKey(channel,t,value){
 const points=state.clip.tracks[channel];const p={t:clamp(t,0,state.clip.duration),v:clamp(value),ease:'smooth'};points.push(p);points.sort((a,b)=>a.t-b.t);
 selectKey(channel,points.indexOf(p));markDirty();return p;
}
canvas.addEventListener('pointerdown',e=>{
 if(!state.clip)return;
 const p=pointerPos(e);stopPlayback();const found=keyFromPosition(p.x,p.y);
 if(found){selectKey(found.channel,found.index);state.drag={mode:'key',ref:selectedKey(),channel:found.channel};}
 else{scrub(p.x);state.drag={mode:'scrub'}};
 canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',e=>{
 if(!state.drag||!state.clip)return;
 const p=pointerPos(e);
 if(state.drag.mode==='scrub'){scrub(p.x);return}
 const lane=laneAt(p.y)||{top:state.drag.channel==='jaw'?110:210,bottom:state.drag.channel==='jaw'?196:296};
 const v=clamp((lane.bottom-12-p.y)/(lane.bottom-lane.top-24));
 const key=state.drag.ref;key.t=clamp(p.x/state.zoom,0,state.clip.duration);key.v=v;
 const points=state.clip.tracks[state.drag.channel];points.sort((a,b)=>a.t-b.t);
 state.selected={channel:state.drag.channel,index:points.indexOf(key)};
 markDirty();updateInspector();render();
});
canvas.addEventListener('pointerup',()=>{state.drag=null});canvas.addEventListener('pointercancel',()=>{state.drag=null});
canvas.addEventListener('dblclick',e=>{
 const p=pointerPos(e),lane=laneAt(p.y);if(!lane)return;
 const t=clamp(p.x/state.zoom,0,state.clip.duration),v=clamp((lane.bottom-12-p.y)/(lane.bottom-lane.top-24));addKey(lane.channel,t,v);render();
});
function simplifySamples(samples,threshold=.05){
 // Ramer–Douglas–Peucker on normalized amplitude against time in seconds.
 const keeps=new Set([0,samples.length-1]);const stack=[[0,samples.length-1]];
 while(stack.length){const [a,b]=stack.pop();if(b-a<2)continue;let worst=0,wi=-1;const p=samples[a],q=samples[b];
  for(let i=a+1;i<b;i++){const s=samples[i],line=p.v+(q.v-p.v)*(s.t-p.t)/Math.max(.00001,q.t-p.t),err=Math.abs(s.v-line);if(err>worst){worst=err;wi=i}}
  if(worst>threshold){keeps.add(wi);stack.push([a,wi],[wi,b])}
 }
 return [...keeps].sort((a,b)=>a-b).map(i=>({...samples[i],ease:'linear'}));
}
function generateJaw(){
 const buf=state.audioBuffer;if(!buf){toast('Import an audio file before generating jaw keyframes.');return}
 const samples=buf.getChannelData(0),rate=buf.sampleRate,interval=.045,window=Math.floor(rate*.025),count=Math.ceil(state.clip.duration/interval);
 const energies=[];
 for(let i=0;i<count;i++){
  const center=Math.floor(i*interval*rate),start=Math.max(0,center-window),end=Math.min(samples.length,center+window);
  let sum=0;for(let n=start;n<end;n++)sum+=samples[n]*samples[n];energies.push(Math.sqrt(sum/Math.max(1,end-start)));
 }
 const sorted=[...energies].sort((a,b)=>a-b),p90=Math.max(.00001,sorted[Math.floor(sorted.length*.90)]||.01);
 const threshold=Number($('jawThreshold').value)/100,intensity=Number($('jawIntensity').value)/100;
 let smooth=0;
 const points=energies.map((v,i)=>{
  const norm=clamp(v/p90,0,1.5),gated=clamp((norm-threshold)/(1-threshold));
  const target=Math.pow(gated,.72)*intensity;
  smooth+=(target-smooth)*(target>smooth?.77:.44);
  return {t:Math.min(state.clip.duration,i*interval),v:clamp(smooth)};
 });
 points.unshift({t:0,v:0});points.push({t:state.clip.duration,v:0});
 state.clip.tracks.jaw=simplifySamples(points,.045).slice(0,3000);
 markDirty();state.selected=null;updateInspector();render();toast(`Generated ${state.clip.tracks.jaw.length} editable jaw keyframes from speech energy.`);
}
function buildCalibration(){
 $('servoCalibration').innerHTML=['jaw','brow'].map(ch=>{
  const s=state.settings[ch];return `<div class="calibration-block" data-servo="${ch}"><h3>${ch==='jaw'?'Jaw SG90':'Brow SG90'}</h3><div class="field-grid"><label class="field">GPIO<input data-key="gpio" type="number" min="1" max="27" value="${s.gpio}"/></label><label class="field">Rest (%)<input data-key="rest" type="number" min="0" max="100" value="${Math.round(s.rest*100)}"/></label><label class="field">Minimum pulse µs<input data-key="min_us" type="number" min="900" max="2000" step="10" value="${s.min_us}"/></label><label class="field">Maximum pulse µs<input data-key="max_us" type="number" min="1000" max="2100" step="10" value="${s.max_us}"/></label></div><label class="check"><input data-key="invert" type="checkbox" ${s.invert?'checked':''}/> Reverse direction</label></div>`;
 }).join('');
 $('audioLatency').value=state.settings.audio_latency_ms;$('audioDevice').value=state.settings.audio_device;$('idleMotion').checked=state.settings.idle_motion;
}
async function saveCalibration(){
 const settings=structuredClone(state.settings);
 for(const section of document.querySelectorAll('.calibration-block')){
  const ch=section.dataset.servo,read=k=>section.querySelector(`[data-key="${k}"]`);
  settings[ch]={gpio:Number(read('gpio').value),rest:clamp(Number(read('rest').value)/100),min_us:Number(read('min_us').value),max_us:Number(read('max_us').value),invert:read('invert').checked};
 }
 settings.audio_latency_ms=Number($('audioLatency').value);settings.audio_device=$('audioDevice').value;settings.idle_motion=$('idleMotion').checked;
 try{state.settings=await api('/api/settings','POST',settings);toast('Calibration saved. Confirm motion without servo linkages first.');}
 catch(e){toast('Calibration rejected: '+e.message)}
}
async function uploadAudio(file){
 if(!file)return;
 $('uploadBtn').disabled=true;$('uploadBtn').textContent='Converting audio…';
 try{
  await saveClip();
  const response=await fetch('/api/audio/'+state.clip.id,{method:'POST',headers:{'X-Filename':file.name,'Content-Type':'application/octet-stream'},body:file});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Upload failed');
  const i=state.project.clips.findIndex(c=>c.id===result.id);state.project.clips[i]=result;state.clip=result;
  state.time=0;makeClipList();$('clipDescription').textContent='Audio loaded · animation editable';$('totalTime').textContent=fmt(state.clip.duration);
  await loadAudio();render();toast(`Audio imported: ${state.clip.duration.toFixed(2)}s, stereo 44.1 kHz WAV.`);
 }catch(e){toast('Audio import failed: '+e.message)}finally{$('uploadBtn').disabled=false;$('uploadBtn').textContent='↑ Import dialogue audio';$('audioFile').value=''}
}
function wireControls(){
 $('saveBtn').onclick=saveClip;
 $('playOnPiBtn').onclick=async()=>{await saveClip();try{const res=await api('/api/play/'+state.clip.id,'POST',{});toast(res.started?'Playing this clip on Pi.':'Pi is already performing.')}catch(e){toast(e.message)}};
 $('playBtn').onclick=togglePlayback;$('stopBtn').onclick=()=>{stopPlayback();api('/api/stop','POST',{}).catch(()=>{})};$('startBtn').onclick=()=>{stopPlayback();scrub(0)};
 $('previewVolume').oninput=e=>audio.volume=Number(e.target.value)/100;
 $('keyTime').onchange=e=>changeSelected('t',Number(e.target.value));$('keyValue').onchange=e=>changeSelected('v',Number(e.target.value)/100);$('keyEase').onchange=e=>changeSelected('ease',e.target.value);
 $('keyChannel').onchange=e=>{const keys=state.clip.tracks[e.target.value];selectKey(e.target.value,keys.length?0:null)};
 $('addKeyBtn').onclick=()=>{const channel=$('keyChannel').value;addKey(channel,state.time,values(state.time)[channel]);render()};
 $('deleteKeyBtn').onclick=()=>{if(!state.selected)return;state.clip.tracks[state.selected.channel].splice(state.selected.index,1);state.selected=null;markDirty();updateInspector();render()};
 $('jawIntensity').oninput=e=>$('intensityLabel').textContent=e.target.value+'%';$('jawThreshold').oninput=e=>$('thresholdLabel').textContent=e.target.value+'%';
 $('generateBtn').onclick=generateJaw;$('uploadBtn').onclick=()=>$('audioFile').click();$('audioFile').onchange=e=>uploadAudio(e.target.files[0]);
 $('saveHardwareBtn').onclick=saveCalibration;
 $('zoom').oninput=e=>{state.zoom=Number(e.target.value);$('zoomLabel').textContent=state.zoom+' px/s';render()};
 $('resetZoomBtn').onclick=()=>{state.zoom=Math.round(clamp(($('timelineScroll').clientWidth-70)/state.clip.duration,65,260));$('zoom').value=state.zoom;$('zoomLabel').textContent=state.zoom+' px/s';render()};
 for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{
  for(const tab of document.querySelectorAll('[data-tab]'))tab.classList.toggle('active',tab===b);
  $('motionInspector').classList.toggle('hidden',b.dataset.tab!=='motion');$('hardwareInspector').classList.toggle('hidden',b.dataset.tab!=='hardware');
 };
 document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveClip()}
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
  if((e.key==='Delete'||e.key==='Backspace')&&state.selected){$('deleteKeyBtn').click();e.preventDefault()}
  if(e.code==='Space'){e.preventDefault();togglePlayback()}
 });
 window.addEventListener('resize',render);
 audio.addEventListener('ended',stopPlayback);
}
function animate(now){
 if(state.clip){
  if(state.playing){
   state.time=state.clip.audio&&!audio.paused?audio.currentTime:state.fromTime+(now-state.startAt)/1000;
   if(state.time>=state.clip.duration){state.time=state.clip.duration;stopPlayback()}
  }
  updateFace();
  if(!animate.lastRender||now-animate.lastRender>30){render();animate.lastRender=now}
 }
 requestAnimationFrame(animate);
}
async function pollStatus(){
 try{
  const s=await api('/api/status');state.busy=s.busy;state.hardware=s.hardware;
  $('connectionDot').classList.add('ready');$('connectionText').textContent=s.hardware?'Pi hardware connected':'Simulation / editor';
  $('livePreview').disabled=!s.hardware;
  if(s.error)$('connectionText').title=s.error;
 }catch{state.hardware=false;$('connectionDot').classList.remove('ready');$('connectionText').textContent='Pi connection lost'}
}
async function init(){
 wireControls();
 try{
  const [project,settings]=await Promise.all([api('/api/project'),api('/api/settings')]);
  state.project=project;state.settings=settings;
  const first=project.clips[0];state.clip=null;
  buildCalibration();await selectClip(first.id);$('zoomLabel').textContent=state.zoom+' px/s';
  await pollStatus();setInterval(pollStatus,1200);requestAnimationFrame(animate);
 }catch(e){toast('Could not initialize editor: '+e.message);$('connectionText').textContent='Offline'}
}
init();
