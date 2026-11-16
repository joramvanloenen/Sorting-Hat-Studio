#!/usr/bin/env python3
"""Rebuild included ORIGINAL (not movie) demo speeches using local eSpeak + ffmpeg.

The shipped voice is intentionally rough/robotic to demonstrate synchronization;
replace it in the browser with your own voice recordings for a better experience.
"""
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from hat_core import load_json, initial_project, atomic_json, PROJECT_FILE, AUDIO

LINES={
 'intro': 'Hmm. Another mind to consider. Let me see what secrets you keep.',
 'ponder': 'Curious... Courage, curiosity, ambition, and kindness. Which of these burns brightest in you?',
 'house_gryffindor': 'You have a bold heart, and courage to spare. Gryffindor!',
 'house_slytherin': 'A determined spirit, with clever plans. Slytherin!',
 'house_ravenclaw': 'So many questions in that busy mind. Ravenclaw!',
 'house_hufflepuff': 'A kind heart, loyal and steady. Hufflepuff!',
}

def track_from_wav(path):
    with wave.open(str(path),'rb') as f:
        assert f.getnchannels()==2 and f.getsampwidth()==2
        rate=f.getframerate();raw=f.readframes(f.getnframes());duration=f.getnframes()/rate
    n=len(raw)//2; data=struct.unpack('<'+'h'*n,raw)
    hop=int(rate*.055);radius=int(rate*.025)
    energies=[]
    for frame in range(0, int(duration*rate), hop):
        start=max(0,frame-radius);end=min(len(data)//2,frame+radius)
        total=sum((data[i*2]/32768)**2 for i in range(start,end))
        energies.append((frame/rate,math.sqrt(total/max(1,end-start))))
    p90=sorted(v for _,v in energies)[int(len(energies)*.9)] if energies else .1
    p90=max(p90,.01)
    smooth=0.0;rawpoints=[{'t':0,'v':0.0,'ease':'linear'}]
    for t,energy in energies:
        norm=max(0,min(1,(energy/p90-.11)/.89))
        target=min(0.9,norm**.75*.85)
        smooth+=(target-smooth)*(.7 if target>smooth else .43)
        rawpoints.append({'t':round(t,3),'v':round(smooth,3),'ease':'linear'})
    rawpoints.append({'t':round(duration,3),'v':0.0,'ease':'linear'})
    # Keep corners at inflection points while reducing redundant tiny segments.
    out=[rawpoints[0]]
    for i in range(1,len(rawpoints)-1):
        a,b,c=rawpoints[i-1:i+2]
        if abs(b['v']-a['v'])>.08 or abs(c['v']-b['v'])>.08:
            out.append(b)
        elif i%4==0:
            out.append(b)
    out.append(rawpoints[-1]);return out,duration


def main():
    if not shutil.which('espeak') or not shutil.which('ffmpeg'):
        raise SystemExit('Requires espeak and ffmpeg')
    project=load_json(PROJECT_FILE,initial_project());AUDIO.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for clip in project['clips']:
            key=clip['id'];raw=Path(tmp)/(key+'_raw.wav');out=AUDIO/(key+'.wav')
            subprocess.run(['espeak','-v','en-gb+m3','-s','120','-p','28','-a','155','-w',str(raw),LINES[key]],check=True)
            subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(raw),'-af','aecho=0.7:0.5:85:0.09',
                            '-ac','2','-ar','44100','-c:a','pcm_s16le',str(out)],check=True)
            points,duration=track_from_wav(out)
            clip['audio']=key+'.wav';clip['duration']=round(duration,3)
            clip['tracks']['jaw']=points
            d=clip['duration']
            b=[{'t':0,'v':.47,'ease':'smooth'},
               {'t':round(d*.10,3),'v':.8,'ease':'smooth'},
               {'t':round(d*.31,3),'v':.45,'ease':'smooth'},
               {'t':round(d*.54,3),'v':.22,'ease':'smooth'},
               {'t':round(d*.75,3),'v':.68,'ease':'smooth'},
               {'t':d,'v':.5,'ease':'smooth'}]
            clip['tracks']['brow']=b
            print(key,round(duration,2),'seconds /',len(points),'jaw keys')
    atomic_json(PROJECT_FILE,project)

if __name__=='__main__':main()
