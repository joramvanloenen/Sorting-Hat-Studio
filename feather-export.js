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
 function mp3Signature(bytes) {
  return bytes.length > 4 && (
   (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) ||
   (bytes[0] === 255 && (bytes[1] & 0xE0) === 0xE0)
  );
 }
 async function asMonoPCM16Wav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
   decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
   await ctx.close();
  }
  const rate = 22050, frameCount = Math.ceil(decoded.duration * rate);
  if (frameCount > rate * 600) throw new Error('A clip is longer than the 10-minute export limit');
  const offline = new OfflineAudioContext(1, frameCount, rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const data = new Uint8Array(44 + samples.length * 2), dv = new DataView(data.buffer);
  function ascii(at, text) { for (let i = 0; i < text.length; i++) data[at+i] = text.charCodeAt(i); }
  ascii(0, 'RIFF'); u32(dv, 4, data.length - 8);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); u32(dv, 16, 16);
  u16(dv, 20, 1); u16(dv, 22, 1); u32(dv, 24, rate);
  u32(dv, 28, rate * 2); u16(dv, 32, 2); u16(dv, 34, 16);
  ascii(36, 'data'); u32(dv, 40, samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
   const v = Math.max(-1, Math.min(1, samples[i]));
   dv.setInt16(44 + 2*i, Math.round(v < 0 ? v*32768 : v*32767), true);
  }
  return data;
 }
 async function getAudio(clip) {
  let blob = await storedAudio(clip.id);
  if (!blob) {
   const res = await fetch('./audio/' + encodeURIComponent(clip.id) + '.mp3');
   if (res.ok) blob = await res.blob();
  }
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Only MP3 is retained as-is. Other types are converted to a documented,
  // CircuitPython-compatible 22.05 kHz mono PCM16 WAV.
  if (mp3Signature(bytes)) return {path:'audio/' + clip.id + '.mp3', bytes};
  return {path:'audio/' + clip.id + '.wav', bytes:await asMonoPCM16Wav(blob)};
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
   const cfg = JSON.parse(settingsText);
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
   const misses = [];
   for (const original of state.project.clips) {
    const id = safeId(original.id);
    const trackName = 'motion/' + id + '.json';
    const motion = {tracks:original.tracks || {jaw:[],brow:[]}};
    files.push([trackName, enc.encode(JSON.stringify(motion))]);
    const c = {id, title:original.title||id, duration:original.duration, motion:trackName, audio:null};
    if (original.audio) {
     button.textContent = 'Packing ' + id + '…';
     try {
      const audio = await getAudio(original);
      if (audio) {files.push([audio.path,audio.bytes]); c.audio = audio.path;}
      else misses.push(id);
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
    '6. Press the button for intro > ponder > random house.\r\n' +
    '7. For power-on playback: config.json start_on_boot = true.\r\n\r\n' +
    'Full instructions: https://github.com/joramvanloenen/Sorting-Hat-Studio/tree/main/feather-rp2040\r\n'
   )]);
   const byteCount = files.reduce((acc, [,bytes])=>acc+bytes.length,0);
   if (byteCount > 5.9 * 1024 * 1024) {
    throw new Error('The exported files use ' + (byteCount/1048576).toFixed(1) +
     ' MB. Feather flash is limited. Reduce/re-encode audio to mono 64–96kbps MP3 and retry.');
   }
   downloadFile('Sorting-Hat-Feather-RP2040.zip', archive(files));
   toast('Feather pack ready: ' + manifest.clips.length + ' performances, ' +
    manifest.clips.filter(c=>c.audio).length + ' audio files.' +
    (misses.length ? ' Missing audio: '+misses.join(', ') : '') +
    ' Extract ZIP to CIRCUITPY root.');
  } catch(e) {
   console.error('Feather export failed', e);
   toast('Feather export failed: ' + e.message);
  } finally {
   button.textContent = prior;
   button.disabled = false;
  }
 });
})();
