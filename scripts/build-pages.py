#!/usr/bin/env python3
"""Build a self-contained static editor for GitHub Pages, based on the Pi editor."""
from pathlib import Path
import json, shutil
ROOT = Path(__file__).resolve().parents[1]
for f in ('index.html', 'app.js', 'style.css'):
    shutil.copyfile(ROOT / 'static' / f, ROOT / f)

p = ROOT / 'index.html'
h = p.read_text()
h = h.replace('<html lang="en">', '<html lang="en" data-pages="1">')
h = h.replace('href="/style.css"', 'href="./style.css"').replace('src="/app.js"', 'src="./app.js"')
h = h.replace('Save changes <span class="keyhint">⌘S</span>', 'Save changes <span class="keyhint">⌘S</span>')
h = h.replace('<button class="primary" id="ceremonyBtn">✦ Run ceremony on Pi</button>', '<button class="ghost" id="importProjectBtn">Import JSON</button><button class="ghost" id="exportProjectBtn">Export JSON</button><button class="primary" id="ceremonyBtn">✦ Preview ceremony</button><input type="file" id="importProjectFile" accept="application/json,.json" hidden>')
h = h.replace('<button class="ghost small" id="playOnPiBtn">▶ Play on Pi</button>', '<button class="ghost small" id="downloadAudioBtn">↓ Download audio</button>')
h = h.replace('Pi Zero W runs the ceremony offline. Edit keyframes here, then test with live servos.', 'GitHub Pages is a browser-only editor. Export your project and import it on the Pi for live servos and playback.')
h = h.replace('Live servos</label>', 'Live servos (Pi only)</label>')
h = h.replace('ANIMATRONIC PERFORMANCE EDITOR / V1.0', 'BROWSER PREVIEW / EXPORT TO RASPBERRY PI')
p.write_text(h)

p = ROOT / 'app.js'; j=p.read_text()
needle="const $ = id => document.getElementById(id);"
addon=r'''
const PAGES_MODE = document.documentElement.dataset.pages === '1';
const STORAGE_PROJECT = 'sorting-hat-pages-project-v1';
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
function downloadFile(name, blob){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function pagesApi(path,method,data){
 if(path==='/api/project'){
  if(!pagesProject){const sample=await (await fetch('./project.json')).json();
   try{pagesProject=JSON.parse(localStorage.getItem(STORAGE_PROJECT))||sample}catch{pagesProject=sample}
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
async function pagesLoadAudio(){
 const token=++state.loadToken;
 audio.pause();audio.removeAttribute('src');audio.load();
 if(!state.clip?.audio)return;
 const clipid=state.clip.id;
 const stored=await storedAudio(clipid);
 const url=stored?URL.createObjectURL(stored):`./audio/${encodeURIComponent(clipid)}.mp3`;
 audio.src=url;audio.load();
 try{
  const res=await fetch(url);if(!res.ok)throw Error('Audio not available');const bytes=await res.arrayBuffer();
  audioContext||=new (window.AudioContext||window.webkitAudioContext)();
  const decoded=await audioContext.decodeAudioData(bytes.slice(0));
  if(token!==state.loadToken)return;
  state.audioBuffer=decoded;state.peaks=calculatePeaks(decoded);render();
 }catch(e){if(token===state.loadToken)toast('Waveform unavailable: '+e.message)}
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
async function previewCeremony(){
 const ids=['intro','ponder','house_'+['gryffindor','slytherin','ravenclaw','hufflepuff'][Math.floor(Math.random()*4)]];
 for(const id of ids){
  if(state.dirty)await saveClip();
  if(state.clip?.id!==id)await selectClip(id);
  state.time=0;await togglePlayback();
  await new Promise(resolve=>{
   const check=setInterval(()=>{if(!state.playing){clearInterval(check);resolve()}},60);
  });
  await new Promise(resolve=>setTimeout(resolve,400));
 }
}
function setupPagesUI(){
 $('ceremonyBtn').onclick=()=>previewCeremony().catch(e=>toast(e.message));
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
'''
j=j.replace(needle,needle+'\n'+addon)
j=j.replace("async function api(path, method='GET', data=null) {\n", "async function api(path, method='GET', data=null) {\n  if(PAGES_MODE)return pagesApi(path,method,data);\n")
j=j.replace('async function loadAudio(){\n', 'async function loadAudio(){\n if(PAGES_MODE)return pagesLoadAudio();\n')
j=j.replace('async function uploadAudio(file){\n', 'async function uploadAudio(file){\n if(PAGES_MODE)return pagesUploadAudio(file);\n')
j=j.replace('function wireControls(){\n', 'function wireControls(){\n')
j=j.replace('async function init(){\n wireControls();', 'async function init(){\n wireControls();if(PAGES_MODE)setupPagesUI();')
p.write_text(j)
shutil.copyfile(ROOT / 'data/project.json', ROOT / 'project.json')
shutil.copyfile(ROOT / 'data/settings.json', ROOT / 'settings.json')
(ROOT / '.nojekyll').write_text('')
# Rewrite README to clarify which assets appear on Pages and bootstrapping sample voice clips.
r = ROOT/'README.md'; readme=r.read_text();readme=readme.replace('![Sorting Hat motion editor](ui-preview.jpg)','![Sorting Hat motion editor](ui-preview.png)\n\n**Live browser preview:** https://joramvanloenen.github.io/Sorting-Hat-Studio/ (GitHub Pages, static editor). This preview saves edits locally in your browser. Export `project.json` to transfer to the Pi; the Pi-hosted editor can directly control hardware.\n\nThe root `index.html`, `app.js`, `style.css`, `audio/`, `project.json`, and `settings.json` are the static GitHub Pages editor. The `static/`, `server.py`, `hat_core.py`, and `data/` files are for the actual Pi.')
readme=readme.replace('Six clips are already configured, with original synthesized demo voice recordings included.', 'Six clips are already configured. For a fresh checkout, run the demo-audio conversion script (below) to prepare them as WAV files for Pi playback.')
readme=readme.replace('2. On the Pi, install packages:', '2. On the Pi, install packages:')
readme=readme.replace('5. Copy the extracted `sorting-hat-studio` folder to the Pi, then run:', '5. Clone this repository onto the Pi and convert the included small MP3 demo lines to WAV with `bash scripts/prepare-demo-audio.sh`. Then run:')
readme=readme.replace('cd ~/sorting-hat-studio\n   python3 server.py', 'cd ~/Sorting-Hat-Studio\n   python3 server.py')
readme=readme.replace('All edits are saved automatically into `data/project.json`', 'Pi-hosted edits are saved automatically into `data/project.json`')
readme+='''\n## Browser-only GitHub Pages editor\n\nThe live site provides the animated face, timeline, waveform, clip library, ceremony preview, and local editing; **GitHub Pages cannot execute Python or control GPIO**. Changes save to this browser (localStorage + IndexedDB), not your GitHub repository. Use **Export JSON** and transfer that `project.json` to the Pi `data/project.json`; convert downloaded audio to `data/audio/<clip-id>.wav` with `ffmpeg -i source.mp3 -ar 44100 -ac 2 -c:a pcm_s16le dest.wav`. The Pi's own editor at `http://<PI_IP>:8080` can upload audio and operate the servos directly.\n\nTo initialise demo audio after cloning:\n\n```bash\nbash scripts/prepare-demo-audio.sh\n```\n'''
r.write_text(readme)
(ROOT/'scripts'/'prepare-demo-audio.sh').write_text('''#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/.."\nmkdir -p data/audio\nif ! command -v ffmpeg >/dev/null; then echo 'Install ffmpeg first: sudo apt install ffmpeg'; exit 1; fi\nfor src in audio/*.mp3; do\n  name="$(basename "$src" .mp3)"\n  [ -f "data/audio/$name.wav" ] && continue\n  ffmpeg -hide_banner -loglevel error -y -i "$src" -ar 44100 -ac 2 -c:a pcm_s16le "data/audio/$name.wav"\ndone\necho 'Demo WAV audio prepared in data/audio/'\n''')
print('Built Pages app')
