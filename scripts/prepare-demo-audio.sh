#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/audio
if ! command -v ffmpeg >/dev/null; then echo 'Install ffmpeg first: sudo apt install ffmpeg'; exit 1; fi
for src in audio/*.mp3; do
  name="$(basename "$src" .mp3)"
  [ -f "data/audio/$name.wav" ] && continue
  ffmpeg -hide_banner -loglevel error -y -i "$src" -ar 44100 -ac 2 -c:a pcm_s16le "data/audio/$name.wav"
done
echo 'Demo WAV audio prepared in data/audio/'
