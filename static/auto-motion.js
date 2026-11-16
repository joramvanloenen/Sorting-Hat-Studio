/* Sorting Hat Studio - deterministic, offline audio-to-performance analysis.
   Pure browser-side JavaScript: no server, upload, cloud, network or dependencies.
   Produces the same {t,v,ease} tracks expected by the Pi performance engine.
*/
(function(root){
  'use strict';
  const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
  const quantile=(sorted,q)=>sorted.length ? sorted[Math.min(sorted.length-1,Math.floor(q*(sorted.length-1)))] : 0;
  const round=t=>Math.round(t*1000)/1000;
  const styleMap={
    subtle:{jaw:.76,brow:.66,rest:.49},
    thoughtful:{jaw:.87,brow:.88,rest:.48},
    theatrical:{jaw:1.00,brow:1.28,rest:.48}
  };
  function hash(n){let x=(n+1)*374761393;x=(x^(x>>>13))*1274126177;return ((x^(x>>>16))>>>0)/4294967295;}
  function simplify(points,tolerance=.045){
    if(points.length<=2)return points;
    const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
    const stack=[[0,points.length-1]];
    while(stack.length){
      const [a,b]=stack.pop();if(b-a<2)continue;
      const p=points[a],q=points[b];let worst=tolerance,worstAt=-1;
      for(let i=a+1;i<b;i++){
        const s=points[i];
        const prediction=p.v+(q.v-p.v)*(s.t-p.t)/Math.max(.00001,q.t-p.t);
        const error=Math.abs(s.v-prediction);
        if(error>worst){worst=error;worstAt=i;}
      }
      if(worstAt>=0){keep[worstAt]=1;stack.push([a,worstAt],[worstAt,b]);}
    }
    return points.filter((_,i)=>keep[i]);
  }
  function normalize(keys,end,rest){
    keys=keys.map(k=>({t:round(clamp(k.t,0,end)),v:round(clamp(k.v)),ease:k.ease||'smooth'})).sort((a,b)=>a.t-b.t);
    const result=[];
    for(const k of keys){if(result.length&&Math.abs(result[result.length-1].t-k.t)<.012)result[result.length-1]=k;else result.push(k);}
    if(!result.length||result[0].t>0)result.unshift({t:0,v:rest,ease:'smooth'});
    result[0].t=0;
    if(result.at(-1).t<end)result.push({t:round(end),v:rest,ease:'smooth'});
    return result;
  }
  function generate(buffer,opts={}){
    if(!buffer||!buffer.length||!buffer.sampleRate)throw Error('The audio could not be decoded.');
    const duration=buffer.duration,rate=buffer.sampleRate;
    if(duration>600)throw Error('For smooth browser editing, use audio clips shorter than 10 minutes.');
    const style=styleMap[opts.style]||styleMap.thoughtful;
    const intensity=clamp((opts.jawIntensity??80)/100,.1,1.5);
    const browIntensity=clamp((opts.browIntensity??80)/100,0,1.5);
    const threshold=clamp((opts.threshold??12)/100,0,.65);
    const hop=.025,frames=Math.max(2,Math.ceil(duration/hop));
    const samples=[];
    const channels=Math.min(buffer.numberOfChannels||1,2);
    for(let c=0;c<channels;c++)samples.push(buffer.getChannelData(c));
    const rms=new Float32Array(frames),zcr=new Float32Array(frames);
    const stride=Math.max(1,Math.floor(rate/11025));
    for(let i=0;i<frames;i++){
      const start=Math.max(0,Math.floor((i*hop-.013)*rate));
      const end=Math.min(buffer.length,Math.floor((i*hop+.023)*rate));
      let sum=0,cross=0,n=0,prev=0;
      for(let j=start;j<end;j+=stride){
        let v=0;for(const ch of samples)v+=ch[j]||0;v/=channels;
        sum+=v*v;if(n&&((v>0)!==(prev>0)))cross++;prev=v;n++;
      }
      rms[i]=Math.sqrt(sum/Math.max(n,1));zcr[i]=cross/Math.max(n,1);
    }
    const sorted=Array.from(rms).sort((a,b)=>a-b);
    const floor=quantile(sorted,.12);
    const peak=Math.max(quantile(sorted,.94),floor+.00008);
    const gate=floor+(peak-floor)*threshold;
    const levels=new Float32Array(frames),isVoice=new Uint8Array(frames);
    for(let i=0;i<frames;i++){
      const norm=clamp((rms[i]-gate)/Math.max(.00005,peak-gate));
      // Sibilants generate energy without opening the mouth as far as vowels.
      const fricative=clamp((zcr[i]-.19)*1.5,0,.3);
      levels[i]=Math.pow(norm,.66)*(1-fricative);
      isVoice[i]=norm>.10?1:0;
    }
    // Remove isolated 25ms noise clicks, and retain natural gaps between phrases.
    for(let i=1;i<frames-1;i++)if(isVoice[i]&&!isVoice[i-1]&&!isVoice[i+1])isVoice[i]=0;
    let smooth=0;
    const jawPoints=[{t:0,v:0,ease:'linear'}];
    for(let i=0;i<frames;i++){
      // Slight lookahead compensates for servo inertia (audio and animation share a clock).
      const future=levels[Math.min(frames-1,i+1)];
      const energy=Math.max(levels[i]*.76,future*.80);
      const target=clamp(energy*intensity*style.jaw);
      smooth+=(target-smooth)*(target>smooth?.42:.27);
      if(smooth<.038)smooth=0;
      jawPoints.push({t:Math.min(duration,i*hop),v:smooth,ease:'linear'});
    }
    jawPoints.push({t:duration,v:0,ease:'linear'});
    // Phrase boundaries are extended across short consonant / word pauses (<160 ms).
    const phrases=[];let start=-1,last=-1;
    for(let i=0;i<frames;i++){
      if(isVoice[i]){if(start<0)start=i;last=i;}
      else if(start>=0&&i-last>7){if(last-start>=3)phrases.push([start,last]);start=-1;last=-1;}
    }
    if(start>=0&&last-start>=3)phrases.push([start,last]);
    const browKeys=[{t:0,v:style.rest,ease:'smooth'}];
    const b=(t,v)=>browKeys.push({t:clamp(t,0,duration),v:clamp(v),ease:'smooth'});
    let accents=0;
    phrases.forEach(([a,z],idx)=>{
      const from=a*hop,to=Math.min(duration,(z+1)*hop),len=to-from;
      const random=hash(idx+Math.round(duration*11));
      const direction=idx%4===2?-1:1;
      const arc=(.13+random*.17)*browIntensity*style.brow*direction;
      const neutral=style.rest;
      // A thinking / anticipatory micro-dip just ahead of an utterance.
      b(Math.max(0,from-.20),neutral);
      b(Math.max(0,from-.055),neutral-.035*browIntensity*style.brow);
      b(Math.min(to,from+.19),neutral+arc);
      if(len>.64){b(Math.min(to,from+len*.51),neutral+arc*.48);accents++;}
      if(len>1.45){
        b(Math.min(to,from+len*.76),neutral+arc*(random>.4?1.28:-.52));accents++;
      }
      b(Math.min(duration,to+.08),neutral+arc*.18);
      b(Math.min(duration,to+.34),neutral);
    });
    b(duration,style.rest);
    const jaw=normalize(simplify(jawPoints,.050),duration,0);
    // Keep pauses in the jaw track even if RDP merges tiny consonant closures.
    jaw[0].v=0;jaw[jaw.length-1].v=0;
    const brow=normalize(browKeys,duration,style.rest);
    brow[0].v=style.rest;brow[brow.length-1].v=style.rest;
    return {jaw,brow,stats:{phrases:phrases.length,accents,jawKeys:jaw.length,browKeys:brow.length,duration:round(duration)}};
  }
  root.HatMotion={generate};
  if(typeof module!=='undefined'&&module.exports)module.exports={generate};
})(typeof window==='undefined'?globalThis:window);

/* Page-side editor integration. The Pi's existing playback engine remains unchanged. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const isPages=typeof PAGES_MODE!=='undefined'&&PAGES_MODE;
  const motionOptions=()=>({
    style:$('motionStyle')?.value||'thoughtful',
    jawIntensity:Number($('jawIntensity')?.value||80),
    browIntensity:Number($('browIntensity')?.value||80),
    threshold:Number($('jawThreshold')?.value||12)
  });
  function naturalMotion(announce=true){
    if(!state.clip||!state.audioBuffer){toast('Import an audio file first, then generate motion.');return false;}
    try{
      const result=window.HatMotion.generate(state.audioBuffer,motionOptions());
      state.clip.tracks.jaw=result.jaw;
      state.clip.tracks.brow=result.brow;
      state.selected=null;
      markDirty();updateInspector();render();updateFace();
      $('trackStats').textContent=`${result.stats.phrases} speech phrases · ${result.stats.jawKeys} jaw + ${result.stats.browKeys} brow keys`;
      if(announce)toast(`Natural motion generated: ${result.stats.phrases} phrases. Press ▶ to preview with your audio.`);
      return true;
    }catch(e){toast('Motion generation failed: '+e.message);return false;}
  }
  window.generateNaturalMotion=naturalMotion;
  $('generateBtn').onclick=()=>naturalMotion();
  $('generateBtn').title='Rebuild both expression tracks from the current audio';
  if($('browIntensity'))$('browIntensity').oninput=e=>$('browIntensityLabel').textContent=e.target.value+'%';
  if($('quickUploadBtn'))$('quickUploadBtn').onclick=()=>$('audioFile').click();

  if(isPages){
    // Fully self-contained: decode and keep the audio in this browser. No Pi requests.
    let currentObjectURL=null;
    pagesUploadAudio=async function(file){
      if(!file)return;
      $('uploadBtn').disabled=true;$('uploadBtn').textContent='Analyzing speech…';
      try{
        if(!/\.(wav|mp3|ogg|m4a|flac|aac|opus)$/i.test(file.name)&&!file.type.startsWith('audio/'))throw Error('Choose a supported audio file.');
        const ctx=audioContext||new (window.AudioContext||window.webkitAudioContext)();audioContext=ctx;
        const decoded=await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));
        if(!decoded.duration||decoded.duration>600)throw Error('Choose an audio clip shorter than 10 minutes.');
        const id=state.clip.id;
        const stored=await storedAudio(id,file);
        stopPlayback();
        if(currentObjectURL)URL.revokeObjectURL(currentObjectURL);
        currentObjectURL=URL.createObjectURL(file);
        audio.src=currentObjectURL;audio.load();
        state.clip.duration=Math.round(decoded.duration*1000)/1000;
        state.clip.audio=id+'.'+(file.name.split('.').pop()||'wav').toLowerCase();
        state.audioBuffer=decoded;state.peaks=calculatePeaks(decoded);
        state.time=0;
        if($('autoGenerate')?.checked!==false)naturalMotion(false);
        else{
          for(const track of Object.values(state.clip.tracks))for(const key of track)key.t=Math.min(key.t,state.clip.duration);
          markDirty();
        }
        await saveClip();
        $('clipDescription').textContent=`${file.name} · ${decoded.duration.toFixed(1)}s · editable jaw + eyebrows`;
        $('totalTime').textContent=fmt(state.clip.duration);
        makeClipList();updateInspector();updateFace();render();
        toast(stored===null?'Audio is ready to preview, but browser storage is unavailable. Download a copy.':'Audio imported and motion generated locally. Press ▶ to watch the hat perform.');
      }catch(e){toast('Audio import failed: '+e.message);}
      finally{$('uploadBtn').disabled=false;$('uploadBtn').textContent='↑ Import dialogue audio';$('audioFile').value='';}
    };
    pollStatus=async function(){
      state.hardware=false;state.busy=false;
      $('connectionDot').classList.add('ready');
      $('connectionText').textContent='LOCAL EDITOR · NO PI NEEDED';
      $('livePreview').disabled=true;$('livePreview').checked=false;
    };
  }else{
    // On the Pi, keep WAV conversion/upload through the existing Python server.
    const existingUpload=uploadAudio;
    uploadAudio=async function(file){
      if(!file)return;
      const previousAudio=state.audioBuffer;
      await existingUpload(file);
      if(state.audioBuffer&&state.audioBuffer!==previousAudio&&$('autoGenerate')?.checked!==false){naturalMotion(false);await saveClip();toast('Audio imported; natural jaw and eyebrow motion saved to Pi.');}
    };
  }
  // Drag and drop on the preview is an alternative to the file button.
  const stage=document.querySelector('.stage');
  if(stage){
    let dragCounter=0;
    stage.addEventListener('dragenter',e=>{e.preventDefault();dragCounter++;stage.classList.add('dragging-audio');});
    stage.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
    stage.addEventListener('dragleave',e=>{e.preventDefault();if(--dragCounter<=0){dragCounter=0;stage.classList.remove('dragging-audio');}});
    stage.addEventListener('drop',e=>{e.preventDefault();dragCounter=0;stage.classList.remove('dragging-audio');const file=[...(e.dataTransfer?.files||[])].find(f=>f.type.startsWith('audio/')||/\.(wav|mp3|ogg|m4a|flac|aac|opus)$/i.test(f.name));if(file)uploadAudio(file);else toast('Drop an audio file such as WAV, MP3 or OGG.');});
  }
})();