#!/usr/bin/env python3
"""Minimal-dependency LAN editor and headless player for Sorting Hat Studio."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from hat_core import AUDIO, ROOT, HatEngine, wav_duration

STATIC = ROOT / "static"
MAX_JSON = 2_000_000
MAX_AUDIO = 48 * 1024 * 1024


class HatHandler(BaseHTTPRequestHandler):
    server_version = "SortingHatStudio/1.0"

    @property
    def engine(self):
        return self.server.engine

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def response_bytes(self, payload: bytes, content_type: str = "application/octet-stream", status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def respond(self, value, status=200):
        self.response_bytes(json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

    def fail(self, detail, code=400):
        self.respond({"error": str(detail)}, code)

    def url_path(self):
        return urlsplit(self.path).path

    def do_GET(self):
        path = self.url_path()
        try:
            if path == "/api/project":
                return self.respond(self.engine.get_project())
            if path == "/api/settings":
                return self.respond(self.engine.get_settings())
            if path == "/api/status":
                return self.respond(self.engine.status())
            if path.startswith("/api/audio/"):
                clipid = path.split("/")[-1]
                project = self.engine.get_project()
                clip = next((c for c in project["clips"] if c["id"] == clipid), None)
                if clip is None or not clip.get("audio"):
                    return self.fail("No audio for this clip", 404)
                f = AUDIO / (clipid + ".wav")
                if not f.exists():
                    return self.fail("Audio missing", 404)
                size = f.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with f.open("rb") as src:
                    shutil.copyfileobj(src, self.wfile, length=65536)
                return
            if path in ("/", "/index.html", "/app.js", "/style.css"):
                name = "index.html" if path == "/" else path[1:]
                p = STATIC / name
                mime = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8"}[p.suffix]
                return self.response_bytes(p.read_bytes(), mime)
            return self.fail("Not found", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            return self.fail(exc, 500)

    def _body(self, limit=MAX_JSON):
        size = int(self.headers.get("Content-Length", "-1"))
        if size < 0 or size > limit:
            raise ValueError("Invalid Content-Length or file too large")
        return self.rfile.read(size)

    def _json_body(self):
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ValueError("Expected application/json")
        return json.loads(self._body())

    def do_POST(self):
        path = self.url_path()
        try:
            if path.startswith("/api/clip/"):
                clipid = path.split("/")[-1]
                return self.respond(self.engine.save_clip(clipid, self._json_body()))
            if path == "/api/settings":
                return self.respond(self.engine.save_settings(self._json_body()))
            if path == "/api/preview":
                body = self._json_body()
                return self.respond({"accepted": self.engine.preview(body["jaw"], body["brow"])})
            if path == "/api/ceremony":
                self._body(4096)
                return self.respond({"started": self.engine.start_ceremony()})
            if path.startswith("/api/play/"):
                self._body(4096)
                return self.respond({"started": self.engine.start_clip(path.split("/")[-1])})
            if path == "/api/stop":
                self._body(4096)
                self.engine.stop()
                return self.respond({"stopping": True})
            if path.startswith("/api/audio/"):
                clipid = path.split("/")[-1]
                if clipid not in {c["id"] for c in self.engine.get_project()["clips"]}:
                    return self.fail("Unknown clip", 404)
                filename = self.headers.get("X-Filename", "voice.wav")[:128]
                if not filename.lower().endswith((".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac")):
                    raise ValueError("Supported: WAV, MP3, OGG, FLAC, M4A, AAC")
                with tempfile.TemporaryDirectory(prefix="hat-upload-") as td:
                    raw = Path(td) / ("input" + Path(filename).suffix.lower())
                    raw.write_bytes(self._body(MAX_AUDIO))
                    if not shutil.which("ffmpeg"):
                        raise RuntimeError("ffmpeg is required to import audio (sudo apt install ffmpeg)")
                    wav = Path(td) / "normalized.wav"
                    task = subprocess.run(
                        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                         "-i", str(raw), "-vn", "-ar", "44100", "-ac", "2",
                         "-c:a", "pcm_s16le", str(wav)], capture_output=True, timeout=180,
                    )
                    if task.returncode or not wav.exists():
                        raise ValueError("Audio conversion failed: " + task.stderr.decode(errors="replace")[-350:])
                    duration = wav_duration(wav)
                    return self.respond(self.engine.set_uploaded_audio(clipid, wav, duration))
            return self.fail("Not found", 404)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return self.fail(exc, 400)
        except subprocess.TimeoutExpired:
            return self.fail("Audio conversion timed out", 408)
        except Exception as exc:
            traceback.print_exc()
            return self.fail(exc, 500)


def main():
    p = argparse.ArgumentParser(description="Sorting Hat Studio editor and player")
    p.add_argument("--host", default="127.0.0.1", help="Use 0.0.0.0 to allow computers on the same trusted LAN")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--hardware", action="store_true", help="Actually move servos and enable GPIO button")
    args = p.parse_args()
    engine = HatEngine(hardware=args.hardware)
    server = ThreadingHTTPServer((args.host, args.port), HatHandler)
    server.engine = engine
    print("Sorting Hat Studio at http://%s:%s  | hardware=%s" % (args.host, args.port, args.hardware))
    print("Use only on a trusted LAN: this prototype has no login or encryption.")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        engine.close()


if __name__ == "__main__":
    main()
