/* Visual status for browser-only MP3 import. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id), host=$('importMonitor'), input=$('audioFile');
 if(!host||!input)return;
 const phases={
  idle:['No audio imported yet','READY','♫'],
  selected:['Audio file selected','SELECTED','♫'],
  decoding:['Decoding MP3 / audio','DECODING','◉'],
  generating:['Generating animation','ANALYZING','◉'],
  saving:['Saving recording','SAVING','◉'],
  ready:['Audio ready to preview','IMPORTED','✓'],
  error:['Audio import failed','ERROR','!']
 };
 window.setImportStatus=(phase,detail)=>{
  const kind=phases[phase]?phase:'selected';
  host.dataset.phase=kind;
  $('importMonitorTitle').textContent=phases[kind][0];
  $('importMonitorStep').textContent=phases[kind][1];
  $('importMonitorIcon').textContent=phases[kind][2];
  $('importMonitorDetail').textContent=detail||'Select a recording to begin.';
  $('importMonitorPreview').hidden=kind!=='ready';
 };
 $('importMonitorChoose').addEventListener('click',()=>input.click());
 $('importMonitorPreview').addEventListener('click',()=>{$('playBtn')?.click()});
 input.addEventListener('change',()=>{
  const f=input.files?.[0];
  if(f)window.setImportStatus('selected','Selected '+f.name+' ('+(f.size/1048576).toFixed(2)+' MB). Waiting for the audio decoder…');
 },true);
 try{if(localStorage.getItem('sorting-hat-last-clip')?.startsWith('import_'))window.setImportStatus('selected','Restoring your previous imported MP3 from browser storage…');}catch(e){}
})();