/* Sorting Hat Studio — offline Feather RP2040 bundle generator.
 * Produces a native ZIP (stored/unencrypted) using only built-in browser APIs.
 * All audio analysis and conversion stays in the user's browser.
 */
(function () {
 'use strict';
 if (document.documentElement.dataset.pages !== '1') return;
 const button = document.getElementById('exportFeatherBtn');
 if (!button) return;
 const enc = new TextEncoder();

 function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
   throw new Error('Invalid clip ID: use only letters, numbers, _ and -');
  }
  return id;
 }
 function u16(dv, pos, v) { dv.setUint16(pos, v, true); }
 function u32(dv, pos, v) { dv.setUint32(pos, v >>> 0, true); }
 const crcTable = new Uint32Array(256);
 for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
 }
 function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
 }
 function archive(files) {
  const local = [], central = [];
  let position = 0;
  const now = new Date();
  const dostime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosdate = (Math.max(0, now.getFullYear() - 1980) << 9) | ((now.getMonth()+1) << 5) | now.getDate();
  for (const [filename, bytes] of files) {
   const name = enc.encode(filename), size = bytes.byteLength, crc = crc32(bytes);
   if (name.length > 65535 || size > 0xFFFFFFFF || position > 0xFFFFFFFF) throw new Error('Export exceeds ZIP format limits');
   const localHeader = new Uint8Array(30 + name.length), ld = new DataView(localHeader.buffer);
   u32(ld, 0, 0x04034b50); u16(ld, 4, 20); u16(ld, 6, 0x0800); u16(ld, 8, 0);
   u16(ld, 10, dostime); u16(ld, 12, dosdate);
   u32(ld, 14, crc); u32(ld, 18, size); u32(ld, 22, size);
   u16(ld, 26, name.length); u16(ld, 28, 0); localHeader.set(name, 30);
   const cd = new Uint8Array(46 + name.length), c = new DataView(cd.buffer);
   u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20);
   u16(c, 8, 0x0800); u16(c, 10, 0);
   u16(c, 12, dostime); u16(c, 14, dosdate);
   u32(c, 16, crc); u32(c, 20, size); u32(c, 24, size);
   u16(c, 28, name.length); u16(c, 30, 0); u16(c, 32, 0);
   u16(c, 34, 0); u16(c, 36, 0); u32(c, 38, 0); u32(c, 42, position);
   cd.set(name, 46);
   local.push(localHeader, bytes);
   central.push(cd);
   position += localHeader.length + size;
  }
  const centralLength = central.reduce((sum, part) => sum + part.length, 0);
  if (files.length > 65535 || centralLength > 0xFFFFFFFF) throw new Error('Too many ZIP entries');
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  u32(e, 0, 0x06054b50);
  u16(e, 8, files.length); u16(e, 10, files.length);
  u32(e, 12, centralLength); u32(e, 16, position); u16(e, 20, 0);
  return new Blob([...local, ...central, end], {type:'application/zip'});
 }
 async function getAudio(clip, sampleRate) {
  const source=await storedAudio('source:'+clip.id);
  const current=await storedAudio(clip.id);
  let blob=source||current;
  if(!blob){
   if(clip.id.startsWith('import_'))throw Error('Uploaded audio missing for '+clip.title+'. Please re-import.');
   const res=await fetch('./audio/'+encodeURIComponent(clip.id)+'.mp3');
   if(res.ok)blob=await res.blob();
  }
  if(!blob)throw Error('Audio missing for '+clip.title+'. Please re-import.');
  if(!source&&current){
   const data=new Uint8Array(await current.arrayBuffer());
   const hdr=window.HatAudioConvert.readWaveHeader(data);
   if(hdr?.valid&&hdr.rate===sampleRate)return {path:'audio/'+clip.id+'.wav',bytes:data};
  }
  const converted=await window.HatAudioConvert.convertBlob(blob,{sampleRate});
  const hdr=window.HatAudioConvert.readWaveHeader(converted.bytes);
  if(!hdr?.valid||hdr.rate!==sampleRate)throw Error('WAV validation failed for '+clip.title);
  return {path:'audio/'+clip.id+'.wav',bytes:converted.bytes};
 }
 async function requestText(path) {
  const response = await fetch(path, {cache:'no-store'});
  if (!response.ok) throw new Error('Missing firmware file ' + path + ' (' + response.status + ')');
  return response.text();
 }

 button.addEventListener('click', async function () {
  if (!state.project) return toast('Editor is still loading.');
  const prior = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing Feather…';
  try {
   if (state.dirty) await saveClip();
   const [firmware, settingsText] = await Promise.all([
    requestText('./feather-rp2040/code.py'),
    requestText('./feather-rp2040/config.json')
   ]);
   if(!window.HatAudioConvert)throw Error('Audio converter missing. Refresh the browser.');
   const cfg = JSON.parse(settingsText);
   // The on-board trigger should play the performance selected in the editor,
   // not a removed factory demo or the empty starter clip.
   const selected=state.project?.clips?.find(c=>c.id===state.clip?.id);
   const onlySelected=document.getElementById('featherSelectedOnly')?.checked!==false;
   if(onlySelected&&!selected?.audio)throw Error('Select a performance with uploaded audio first.');
   const clips=onlySelected?[selected]:state.project.clips.filter(c=>c.audio);
   if(!clips.length)throw Error('There is no audio to export. Import a recording first.');
   cfg.clip_id=(selected?.audio?selected:clips[0]).id;
   const wavRate=Number(document.getElementById('wavQuality')?.value||22050);
   window.HatAudioConvert.assertRate(wavRate);
   // Safe pulse settings from the browser's calibration panel.
   for (const ch of ['jaw', 'brow']) {
    const setting = state.settings && state.settings[ch];
    if (!setting) continue;
    for (const field of ['rest', 'min_us', 'max_us', 'invert']) {
     if (setting[field] !== undefined) cfg[ch][field] = setting[field];
    }
   }
   const files = [
    ['code.py', enc.encode(firmware)],
    ['config.json', enc.encode(JSON.stringify(cfg,null,2))],
   ];
   const manifest = {version:1, platform:'feather-rp2040', clips:[]};
   for (const original of clips) {
    const id = safeId(original.id);
    const trackName = 'motion/' + id + '.json';
    const motion = {tracks:original.tracks || {jaw:[],brow:[]}};
    files.push([trackName, enc.encode(JSON.stringify(motion))]);
    const c = {id, title:original.title||id, duration:original.duration, motion:trackName, audio:null};
    if (original.audio) {
     button.textContent = 'Packing ' + id + '…';
     try {
      const normalized=await getAudio(original,wavRate);
      files.push([normalized.path,normalized.bytes]);c.audio=normalized.path;
     } catch (e) {
      throw new Error('Audio conversion failed for ' + id + ': ' + e.message);
     }
    }
    manifest.clips.push(c);
   }
   files.push(['project.json', enc.encode(JSON.stringify(manifest,null,2))]);
   files.push(['README.txt', enc.encode(
    'SORTING HAT FEATHER RP2040\r\n\r\n' +
    '1. Install CircuitPython for Adafruit Feather RP2040 (not Pico).\r\n' +
    '2. Extract the ZIP contents directly into the CIRCUITPY drive root.\r\n' +
    '3. MAX98357A: A0=BCLK, A1=LRC, A2=DIN, 3V=VIN, GND=GND.\r\n' +
    '4. Jaw servo signal D4; brow servo signal D5; button D9 to GND.\r\n' +
    '5. Servos need a dedicated 5V supply and shared ground.\r\n' +
    '6. Press the button to play the selected converted PCM WAV clip.\r\n' +
    '7. For power-on playback: config.json start_on_boot = true.\r\n\r\n' +
    'Full instructions: https://github.com/joramvanloenen/Sorting-Hat-Studio/tree/main/feather-rp2040\r\n'
   )]);
   const byteCount = files.reduce((acc, [,bytes])=>acc+bytes.length,0);
   if (byteCount > 5.9 * 1024 * 1024) {
    throw new Error('The exported files use ' + (byteCount/1048576).toFixed(1) +
     ' MB. Feather flash is limited. Export one performance or use 16 kHz Compact WAV.');
   }
   downloadFile('Sorting-Hat-Feather-RP2040.zip', archive(files));
   toast('Feather pack ready: ' + manifest.clips.length + ' performances, ' +
    manifest.clips.filter(c=>c.audio).length + ' audio files.' +
    ' PCM16 mono WAV at '+(wavRate/1000).toFixed(2)+' kHz. Extract to CIRCUITPY root.');
  } catch(e) {
   console.error('Feather export failed', e);
   toast('Feather export failed: ' + e.message);
  } finally {
   button.textContent = prior;
   button.disabled = false;
  }
 });
})();
