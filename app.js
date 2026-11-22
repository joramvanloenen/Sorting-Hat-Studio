/* Sorting Hat Studio — browser motion editor. No build tools or external libraries. */
'use strict';
const $ = id => document.getElementById(id);

const PAGES_MODE = document.documentElement.dataset.pages === '1';
const STORAGE_PROJECT = 'sorting-hat-pages-project-v2';
const LEGACY_PROJECT_KEY = 'sorting-hat-pages-project-v1';
const LEGACY_BACKUP_KEY = 'sorting-hat-legacy-project-backup-v1';
const LEGACY_PRESET_IDS = new Set(["intro","ponder","house_gryffindor","house_slytherin","house_ravenclaw","house_hufflepuff"]);
function migrateOldLibrary(old, starter) {
 const custom=(Array.isArray(old?.clips)?old.clips:[])
  .filter(c=>c&&!LEGACY_PRESET_IDS.has(c.id)&&c.tracks?.jaw&&c.tracks?.brow);
 return {version:2,clips:custom.length?custom:structuredClone(starter.clips)};
}
const STORAGE_SETTINGS = 'sorting-hat-pages-settings-v1';
let pagesProject = null, pagesSettings = null;

function openAudioDB() {
 return new Promise((resolve, reject)=>{
  const req=indexedDB.open('sorting-hat-audio-v1',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('clips');
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}
async function storedAudio(id, val) {
 try {
  const db=await openAudioDB();
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('clips',val===undefined?'readonly':'readwrite');
   const req=val===undefined?tx.objectStore('clips').get(id):tx.objectStore('clips').put(val,id);
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error);
   tx.oncomplete=()=>db.close();
  });
 }catch(e){console.warn('Audio database unavailable',e);return null}
}
async function deleteStoredAudio(id){
 // Remove both the normalized WAV and the retained source recording.
 // Resolve only when IndexedDB confirms the transaction has committed.
 const db=await openAudioDB();
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('clips','readwrite'),store=tx.objectStore('clips');
   store.delete(id);store.delete('source:'+id);
   tx.oncomplete=()=>resolve();
   tx.onerror=()=>reject(tx.error||Error('Browser audio deletion failed'));
   tx.onabort=()=>reject(tx.error||Error('Browser audio deletion aborted'));
  });
 }finally{db.close()}
}
function emptyPerformance(){
 return {id:'performance_1',title:'New Performance',duration:4,audio:null,
 tracks:{jaw:[{t:0,v:0,ease:'smooth'},{t:4,v:0,ease:'smooth'}],
 brow:[{t:0,v:.5,ease:'smooth'},{t:4,v:.5,ease:'smooth'}]}};
}
function downloadFile(name, blob){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function pagesApi(path,method,data){
 if(path==='/api/project'){
  if(!pagesProject){
   const sample=await (await fetch('./project.json?v=blank-library-20261122',{cache:'no-store'})).json();
   try{
    const existing=JSON.parse(localStorage.getItem(STORAGE_PROJECT));
    if(Array.isArray(existing?.clips)&&existing.clips.length)pagesProject=existing;
    else{
     const old=JSON.parse(localStorage.getItem(LEGACY_PROJECT_KEY));
     if(Array.isArray(old?.clips)){
      if(!localStorage.getItem(LEGACY_BACKUP_KEY))
       localStorage.setItem(LEGACY_BACKUP_KEY,JSON.stringify(old));
      pagesProject=migrateOldLibrary(old,sample);
     }else pagesProject=sample;
     localStorage.setItem(STORAGE_PROJECT,JSON.stringify(pagesProject));
    }
   }catch(e){console.warn('Could not migrate stored recordings:',e);pagesProject=sample}
  }return pagesProject;
 }
 if(path==='/api/settings'){
  if(method==='GET'){
   if(!pagesSettings){const sample=await (await fetch('./settings.json')).json();
    try{pagesSettings=JSON.parse(localStorage.getItem(STORAGE_SETTINGS))||sample}catch{pagesSettings=sample}
   }return pagesSettings;
  }
  pagesSettings=structuredClone(data);localStorage.setItem(STORAGE_SETTINGS,JSON.stringify(pagesSettings));return pagesSettings;
 }
 if(path.startsWith('/api/audio/')&&method==='DELETE'){
  const id=path.split('/').at(-1);
  const idx=pagesProject.clips.findIndex(c=>c.id===id);
  if(idx<0)throw Error('Performance not found');
  if(!pagesProject.clips[idx].audio)throw Error('This performance has no audio');
  await deleteStoredAudio(id);
  pagesProject.clips[idx]={...pagesProject.clips[idx],audio:null};
  localStorage.setItem(STORAGE_PROJECT,JSON.stringify(pagesProject));
  return structuredClone(pagesProject.clips[idx]);
 }
 if(path.startsWith('/api/clip/')&&method==='DELETE'){
  const id=path.split('/').at(-1);
  const idx=pagesProject.clips.findIndex(c=>c.id===id);
  if(idx<0)throw Error('Performance not found');
  await deleteStoredAudio(id);
  pagesProject.clips.splice(idx,1);
  if(!pagesProject.clips.length)pagesProject.clips.push(emptyPerformance());
  localStorage.setItem(STORAGE_PROJECT,JSON.stringify(pagesProject));
  return {deleted:true,clips:structuredClone(pagesProject.clips)};
 }
 if(path.startsWith('/api/clip/')&&method==='POST'){
  const id=path.split('/').at(-1),index=pagesProject.clips.findIndex(c=>c.id===id);
  if(index<0)throw Error('Unknown clip');pagesProject.clips[index]=structuredClone(data);
  localStorage.setItem(STORAGE_PROJECT,JSON.stringify(pagesProject));return pagesProject.clips[index];
 }
 if(path==='/api/status')return {hardware:false,busy:false};
 if(path==='/api/stop')return {stopping:true};
 if(path==='/api/preview')return {accepted:false};
 throw Error('Connect to the Raspberry Pi for hardware playback. This is a browser-only preview.');
}
let currentSavedAudioURL=null;
async function pagesLoadAudio(){
 const token=++state.loadToken;
 audio.pause();audio.removeAttribute('src');audio.load();
 if(currentSavedAudioURL){URL.revokeObjectURL(currentSavedAudioURL);currentSavedAudioURL=null}
 if(!state.clip?.audio){
  state.audioBuffer=null;state.peaks=null;window.updateAudioInfo?.(null,null);return;
 }
 const clipid=state.clip.id;
 try{
  const stored=await storedAudio(clipid);
  if(token!==state.loadToken)return;
  if(!stored&&clipid.startsWith('import_'))throw Error('Imported audio missing from this browser. Re-import the recording.');
  let bytes;
  if(stored){
   currentSavedAudioURL=URL.createObjectURL(stored);
   audio.src=currentSavedAudioURL;
   bytes=await stored.arrayBuffer();
  }else{
   const url='./audio/'+encodeURIComponent(clipid)+'.mp3';
   const res=await fetch(url);
   if(!res.ok)throw Error('Source audio is missing ('+res.status+')');
   bytes=await res.arrayBuffer();
   audio.src=url;
  }
  audio.load();
  audioContext||=new (window.AudioContext||window.webkitAudioContext)();
  const decoded=await audioContext.decodeAudioData(bytes.slice(0));
  if(token!==state.loadToken)return;
  state.audioBuffer=decoded;state.peaks=calculatePeaks(decoded);render();
  window.updateAudioInfo?.(stored,decoded);
  if(stored&&clipid.startsWith('import_')&&window.setImportStatus)
   window.setImportStatus('ready',state.clip.title+' · '+decoded.duration.toFixed(1)+'s · Audio restored and ready.');
 }catch(e){
  if(token===state.loadToken){
   state.audioBuffer=null;state.peaks=null;
   window.updateAudioInfo?.(null,null,e.message);
   window.setImportStatus?.('error','Audio unavailable for '+state.clip.title+': '+e.message);
   toast('Audio unavailable: '+e.message);
  }
 }
}
async function pagesUploadAudio(file){
 if(!file)return;
 try{
  await storedAudio(state.clip.id,file);
  state.clip.audio=state.clip.id+'.wav';
  audioContext||=new (window.AudioContext||window.webkitAudioContext)();
  const decoded=await audioContext.decodeAudioData(await file.arrayBuffer());
  state.clip.duration=Math.round(decoded.duration*1000)/1000;
  // Preserve keyframe values but bring all timestamps into the new duration.
  for(const track of Object.values(state.clip.tracks))for(const key of track)key.t=Math.min(key.t,state.clip.duration);
  markDirty();await saveClip();await pagesLoadAudio();makeClipList();
  $('totalTime').textContent=fmt(state.clip.duration);render();
  toast('Audio imported to this browser. Export JSON and download audio to transfer to your Pi.');
 }catch(e){toast('Import failed: '+e.message)}
 finally{$('uploadBtn').disabled=false;$('uploadBtn').textContent='↑ Import dialogue audio';$('audioFile').value=''}
}
function setupPagesUI(){
 $('livePreview').disabled=true;$('livePreview').checked=false;
 $('exportProjectBtn').onclick=async()=>{
  if(state.dirty)await saveClip();
  const project=structuredClone(state.project);
  for(const c of project.clips)if(c.audio)c.audio=c.id+'.wav';
  downloadFile('project.json',new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));
  toast('Project JSON exported. Audio files must be transferred separately.');
 };
 $('importProjectBtn').onclick=()=>$('importProjectFile').click();
 $('importProjectFile').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
   const p=JSON.parse(await file.text());
   if(!Array.isArray(p.clips)||!p.clips.length||p.clips.some(c=>!c.id||!c.tracks?.jaw||!c.tracks?.brow))throw Error('Invalid project');
   pagesProject=p;localStorage.setItem(STORAGE_PROJECT,JSON.stringify(p));
   state.project=p;state.clip=null;state.dirty=false;await selectClip(p.clips[0].id);
   toast('Project imported into this browser.');
  }catch(err){toast('Invalid JSON: '+err.message)}
  e.target.value='';
 };
 $('downloadAudioBtn').onclick=async()=>{
  const id=state.clip.id,blob=await storedAudio(id);
  if(blob){downloadFile(id+'.'+(blob.type.includes('mpeg')?'mp3':blob.type.includes('ogg')?'ogg':'wav'),blob);return}
  const res=await fetch(`./audio/${id}.mp3`);if(res.ok)downloadFile(id+'.mp3',await res.blob());else toast('No audio available. Import one first.');
 };
}

const clamp = (v, a=0, b=1) => Math.min(b, Math.max(a, Number(v)));
const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${String(Math.floor(s%1*100)).padStart(2,'0')}`;
const state = {project:null,settings:null,clip:null,selected:null,time:0,playing:false,startAt:0,fromTime:0,zoom:128,peaks:null,audioBuffer:null,hardware:false,busy:false,drag:null,saving:false,dirty:false,saveTimer:null,prevPreviewAt:0,loadToken:0};
const audio = $('audio');
const canvas = $('timeline');
const ctx = canvas.getContext('2d');
let audioContext;

async function api(path, method='GET', data=null) {
  if(PAGES_MODE)return pagesApi(path,method,data);
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
  const row=document.createElement('div');row.className='clip-entry';
  const button=document.createElement('button');button.className='clip'+(clip.id===state.clip?.id?' active':'');
  button.innerHTML=`<span class="clip-icon">${icons[i%icons.length]}</span><div class="clip-summary"><div class="clip-title"></div><div class="clip-meta"></div></div>`;
  button.querySelector('.clip-title').textContent=clip.title;
  button.querySelector('.clip-meta').textContent=`${clip.duration.toFixed(1)}s · ${clip.audio?'audio ready':'no audio'}`;
  button.addEventListener('click',()=>selectClip(clip.id));row.append(button);
  const actions=document.createElement('div');actions.className='clip-actions';
  const strip=document.createElement('button');
  strip.type='button';strip.className='clip-remove-audio';
  strip.textContent='♫×';strip.title='Remove audio from '+clip.title+' (keep motion)';
  strip.setAttribute('aria-label','Remove audio from '+clip.title);
  strip.disabled=!clip.audio;
  strip.addEventListener('click',()=>removePerformanceAudio(clip.id));
  actions.append(strip);
  const del=document.createElement('button');
  del.type='button';del.className='clip-delete';
  del.textContent='×';del.title='Delete performance '+clip.title+' and its audio';
  del.setAttribute('aria-label','Delete performance '+clip.title);
  del.addEventListener('click',()=>deletePerformance(clip.id));
  actions.append(del);row.append(actions);$('clipList').append(row);
 });
}
async function removePerformanceAudio(id){
 const clip=getClip(id);
 if(!clip?.audio)return;
 if(!confirm('Remove the audio from “'+clip.title+'”? Your jaw and eyebrow keyframes will remain.'))return;
 try{
  if(state.clip?.id===id && state.dirty)await saveClip();
  const result=await api('/api/audio/'+encodeURIComponent(id),'DELETE');
  const idx=state.project.clips.findIndex(c=>c.id===id);
  if(idx>=0)state.project.clips[idx]=result;
  if(state.clip?.id===id){
   stopPlayback();releaseScrubGrain();window.releaseImportedAudioURL?.();
   state.dirty=false;state.clip=null;
   await selectClip(id);
   window.setImportStatus?.('idle','Audio removed. Keyframes were preserved. Import a new recording whenever you like.');
  }else makeClipList();
  toast('Audio removed from “'+clip.title+'”. Animation retained.');
 }catch(err){toast('Could not remove audio: '+err.message);console.error(err)}
}
async function deletePerformance(id){
 const clip=getClip(id);
 if(!clip)return;
 if(!confirm('Delete “'+clip.title+'” and its audio from the library? This also removes its animation keyframes.'))return;
 try{
  const deletingSelected=state.clip?.id===id;
  const previousId=deletingSelected?null:state.clip?.id;
  if(!deletingSelected&&state.dirty)await saveClip();
  if(deletingSelected){
   stopPlayback();releaseScrubGrain();window.releaseImportedAudioURL?.();
   state.dirty=false;clearTimeout(state.saveTimer);
  }
  const result=await api('/api/clip/'+encodeURIComponent(id),'DELETE');
  state.project.clips=result.clips;
  state.clip=null;state.selected=null;state.dirty=false;
  const next=state.project.clips.find(c=>c.id===previousId)||state.project.clips[0];
  await selectClip(next.id);
  toast('Performance deleted.');
 }catch(err){toast('Could not delete performance: '+err.message);console.error(err)}
}
async function selectClip(id){
 if(state.clip?.id===id)return;
 stopPlayback();if(state.dirty)await saveClip();
 releaseScrubGrain();
 state.clip=getClip(id);state.selected=null;state.time=0;state.peaks=null;state.audioBuffer=null;
 if(PAGES_MODE){try{localStorage.setItem('sorting-hat-last-clip',id)}catch(e){}}
 makeClipList();window.refreshAudioTools?.();$('clipTitle').textContent=state.clip.title;
 $('clipDescription').textContent=state.clip.audio?'Audio loaded · animation editable':'No recorded audio yet · motion preview available';
 $('totalTime').textContent=fmt(state.clip.duration);
 $('trackStats').textContent=`Jaw: ${state.clip.tracks.jaw.length} keys · Brows: ${state.clip.tracks.brow.length} keys`;
 updateInspector();await loadAudio();render();
}
async function loadAudio(){
 if(PAGES_MODE)return pagesLoadAudio();
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
 // Keep the Pi's two servo channels and the browser visualization in step.
 const browLayer=$('hatBrowLayer'),lipLayer=$('hatUpperLipLayer');
 if(browLayer){
  const lift=clamp(brow,0,1)-0.5;
  browLayer.style.transform=`translate3d(0,${(-32*lift).toFixed(2)}%,0) rotate(${(-6*lift).toFixed(2)}deg)`;
 }
 if(lipLayer){
  const open=clamp(jaw,0,1);
  // Pull the upper lip away from the dark mouth cavity in the supplied base.
  lipLayer.style.transform=`translate3d(0,${(-28*open).toFixed(2)}%,0) rotate(${(-2.6*open).toFixed(2)}deg) scaleY(${(1-0.06*open).toFixed(3)})`;
 }
 $('jawReadout').textContent=Math.round(jaw*100)+'%';
 $('browReadout').textContent=Math.round(brow*100)+'%';
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
// Web Audio grains make paused MP3/WAV scrubbing audible without starting normal playback.
// Each grain is softly faded to avoid clicks when dragging the playhead quickly.
let activeScrubGrain=null, lastScrubGrainAt=-Infinity, lastScrubSampleTime=-Infinity;
function releaseScrubGrain(){
 if(!activeScrubGrain||!audioContext)return;
 const {source,gain}=activeScrubGrain;activeScrubGrain=null;
 const now=audioContext.currentTime;
 try{
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(0,gain.gain.value),now);
  gain.gain.linearRampToValueAtTime(0,now+.015);
  source.stop(now+.019);
 }catch(e){/* grain already ended */}
}
function auditionScrub(t){
 if(!$('scrubAudioEnabled')?.checked||!state.audioBuffer||!audioContext)return;
 const context=audioContext,buffer=state.audioBuffer;
 if(!Number.isFinite(t)||!(buffer.duration>0))return;
 // Resume inside pointer gesture: autoplay policies otherwise block WebAudio.
 if(context.state==='suspended')context.resume().catch(()=>{});
 const nowMS=performance.now();
 // Limit grain creation; never create new sounds for imperceptible seeks.
 if(nowMS-lastScrubGrainAt<56||(Math.abs(t-lastScrubSampleTime)<.012&&nowMS-lastScrubGrainAt<180))return;
 lastScrubGrainAt=nowMS;lastScrubSampleTime=t;
 releaseScrubGrain();
 const offset=clamp(t-.018,0,Math.max(0,buffer.duration-.02));
 const duration=Math.min(.115,buffer.duration-offset);
 if(duration<.016)return;
 const source=context.createBufferSource(),gain=context.createGain();
 const volume=clamp(Number($('previewVolume').value)/100,0,1)*.78;
 source.buffer=buffer;source.connect(gain);gain.connect(context.destination);
 const start=context.currentTime+.004;
 gain.gain.setValueAtTime(0,start);
 gain.gain.linearRampToValueAtTime(volume,start+Math.min(.009,duration*.25));
 gain.gain.setValueAtTime(volume,start+Math.max(.009,duration-.025));
 gain.gain.linearRampToValueAtTime(0,start+duration);
 source.start(start,offset,duration);
 source.stop(start+duration+.004);
 activeScrubGrain={source,gain};
 source.onended=()=>{if(activeScrubGrain?.source===source)activeScrubGrain=null;try{source.disconnect();gain.disconnect()}catch(e){}};
}

function scrub(x,withAudio=false){
 state.time=clamp(x/state.zoom,0,state.clip.duration);
 if(state.clip.audio){try{audio.currentTime=state.time}catch(e){}}
 state.fromTime=state.time;state.startAt=performance.now();
 if(withAudio)auditionScrub(state.time);
 updateFace();render();
}
function stopPlayback(){state.playing=false;audio.pause();$('playBtn').textContent='▶'}
async function togglePlayback(){
 releaseScrubGrain();
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
 else{scrub(p.x,true);state.drag={mode:'scrub'}};
 canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',e=>{
 if(!state.drag||!state.clip)return;
 const p=pointerPos(e);
 if(state.drag.mode==='scrub'){scrub(p.x,true);return}
 const lane=laneAt(p.y)||{top:state.drag.channel==='jaw'?110:210,bottom:state.drag.channel==='jaw'?196:296};
 const v=clamp((lane.bottom-12-p.y)/(lane.bottom-lane.top-24));
 const key=state.drag.ref;key.t=clamp(p.x/state.zoom,0,state.clip.duration);key.v=v;
 const points=state.clip.tracks[state.drag.channel];points.sort((a,b)=>a.t-b.t);
 state.selected={channel:state.drag.channel,index:points.indexOf(key)};
 markDirty();updateInspector();render();
});
function endTimelineDrag(){state.drag=null;releaseScrubGrain()}
canvas.addEventListener('pointerup',endTimelineDrag);
canvas.addEventListener('pointercancel',endTimelineDrag);
canvas.addEventListener('lostpointercapture',endTimelineDrag);
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
 if(PAGES_MODE)return pagesUploadAudio(file);
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
 // Import events must work even if optional Pi controls are absent.
 $('uploadBtn').onclick=()=>$('audioFile').click();
 $('audioFile').addEventListener('change',e=>{
  const file=e.target.files?.[0];if(!file)return;
  Promise.resolve().then(()=>uploadAudio(file)).catch(err=>{
   console.error('Sorting Hat audio import handler failed',err);
   window.setImportStatus?.('error','Could not start audio import: '+(err?.message||err));
   toast('Could not start audio import: '+(err?.message||err));
  });
 });
 $('saveBtn').onclick=saveClip;
 if($('playOnPiBtn'))$('playOnPiBtn').onclick=async()=>{await saveClip();try{const res=await api('/api/play/'+state.clip.id,'POST',{});toast(res.started?'Playing this clip on Pi.':'Pi is already performing.')}catch(e){toast(e.message)}};
 $('playBtn').onclick=togglePlayback;$('stopBtn').onclick=()=>{stopPlayback();api('/api/stop','POST',{}).catch(()=>{})};$('startBtn').onclick=()=>{stopPlayback();scrub(0)};
 $('previewVolume').oninput=e=>audio.volume=Number(e.target.value)/100;
 $('keyTime').onchange=e=>changeSelected('t',Number(e.target.value));$('keyValue').onchange=e=>changeSelected('v',Number(e.target.value)/100);$('keyEase').onchange=e=>changeSelected('ease',e.target.value);
 $('keyChannel').onchange=e=>{const keys=state.clip.tracks[e.target.value];selectKey(e.target.value,keys.length?0:null)};
 $('addKeyBtn').onclick=()=>{const channel=$('keyChannel').value;addKey(channel,state.time,values(state.time)[channel]);render()};
 $('deleteKeyBtn').onclick=()=>{if(!state.selected)return;state.clip.tracks[state.selected.channel].splice(state.selected.index,1);state.selected=null;markDirty();updateInspector();render()};
 $('jawIntensity').oninput=e=>$('intensityLabel').textContent=e.target.value+'%';$('jawThreshold').oninput=e=>$('thresholdLabel').textContent=e.target.value+'%';
 $('generateBtn').onclick=generateJaw;
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
 try{
  wireControls();if(PAGES_MODE)setupPagesUI();
  const [project,settings]=await Promise.all([api('/api/project'),api('/api/settings')]);
  state.project=project;state.settings=settings;
  let lastClip=null;if(PAGES_MODE){try{lastClip=localStorage.getItem('sorting-hat-last-clip')}catch(e){}}const first=project.clips.find(c=>c.id===lastClip)||project.clips[0];state.clip=null;
  buildCalibration();await selectClip(first.id);$('zoomLabel').textContent=state.zoom+' px/s';
  await pollStatus();setInterval(pollStatus,1200);requestAnimationFrame(animate);
 }catch(e){
  console.error('Sorting Hat editor initialization failed',e);
  const msg='Editor setup failed: '+(e?.message||e);
  window.setImportStatus?.('error',msg);
  toast(msg);$('connectionText').textContent='Editor setup error';
 }
}
init();