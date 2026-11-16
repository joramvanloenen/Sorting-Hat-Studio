"""Sorting Hat Studio: hardware-safe timeline interpolation and playback.

This module has no mandatory third-party dependencies. Hardware mode uses pigpio
for DMA-timed pulses and gpiozero for a trigger switch (Pi Zero W supported).
"""
from __future__ import annotations

import json
import math
import os
import random
import shutil
import subprocess
import threading
import time
import wave
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
AUDIO = DATA / "audio"
PROJECT_FILE = DATA / "project.json"
SETTINGS_FILE = DATA / "settings.json"
HOUSES = ("gryffindor", "slytherin", "ravenclaw", "hufflepuff")


def clip_template(clip_id: str, title: str, duration: float = 4.0) -> dict:
    return {
        "id": clip_id,
        "title": title,
        "duration": duration,
        "audio": None,
        "tracks": {
            "jaw": [
                {"t": 0, "v": 0, "ease": "smooth"},
                {"t": 0.45, "v": 0, "ease": "smooth"},
                {"t": 0.65, "v": 0.42, "ease": "smooth"},
                {"t": 0.93, "v": 0.15, "ease": "smooth"},
                {"t": 1.22, "v": 0.72, "ease": "smooth"},
                {"t": 1.48, "v": 0.0, "ease": "smooth"},
                {"t": 2.0, "v": 0.50, "ease": "smooth"},
                {"t": 2.25, "v": 0, "ease": "smooth"},
                {"t": duration, "v": 0, "ease": "smooth"},
            ],
            "brow": [
                {"t": 0, "v": 0.5, "ease": "smooth"},
                {"t": 0.45, "v": 0.83, "ease": "smooth"},
                {"t": 1.35, "v": 0.48, "ease": "smooth"},
                {"t": 2.5, "v": 0.25, "ease": "smooth"},
                {"t": duration, "v": 0.5, "ease": "smooth"},
            ],
        },
    }


def initial_project() -> dict:
    return {
        "version": 1,
        "clips": [
            clip_template("intro", "01 · Awakening", 4),
            clip_template("ponder", "02 · Considering", 5),
            *[clip_template("house_" + h, "House · " + h.title(), 3) for h in HOUSES],
        ],
    }


def initial_settings() -> dict:
    return {
        "jaw": {"gpio": 17, "min_us": 1200, "max_us": 1750, "invert": False, "rest": 0.0},
        "brow": {"gpio": 27, "min_us": 1200, "max_us": 1750, "invert": False, "rest": 0.5},
        "button_gpio": 22,
        "audio_latency_ms": 65,
        "audio_device": "default",
        "idle_motion": True,
    }


def clamp(value, lo=0.0, hi=1.0):
    return max(lo, min(hi, float(value)))


def validate_clip(clip: dict, existing_id: str | None = None) -> dict:
    if not isinstance(clip, dict) or clip.get("id") != existing_id:
        raise ValueError("Clip ID cannot be changed")
    result = deepcopy(clip)
    if not isinstance(result.get("title"), str):
        raise ValueError("Missing clip title")
    result["title"] = result["title"][:100]
    result["duration"] = float(result["duration"])
    if not (0.1 <= result["duration"] <= 600):
        raise ValueError("Duration must be 0.1–600 seconds")
    audio = result.get("audio")
    if audio not in (None, existing_id + ".wav"):
        raise ValueError("Audio file name cannot be changed this way")
    if not isinstance(result.get("tracks"), dict):
        raise ValueError("Missing tracks")
    for ch in ("jaw", "brow"):
        points = result["tracks"].get(ch)
        if not isinstance(points, list) or len(points) > 3000:
            raise ValueError("Each channel needs 0–3000 keyframes")
        cleaned = []
        for key in points:
            t = float(key["t"])
            v = float(key["v"])
            if not (math.isfinite(t) and math.isfinite(v)):
                raise ValueError("Invalid keyframe numbers")
            cleaned.append({"t": clamp(t, 0, result["duration"]),
                            "v": clamp(v),
                            "ease": key.get("ease") if key.get("ease") in ("smooth", "linear", "hold") else "smooth"})
        cleaned.sort(key=lambda k: k["t"])
        # Avoid zero-width segments and accidental duplicate keys.
        deduped = []
        for k in cleaned:
            if deduped and abs(k["t"] - deduped[-1]["t"]) < 0.0005:
                deduped[-1] = k
            else:
                deduped.append(k)
        result["tracks"][ch] = deduped
    return result


def validate_settings(settings: dict) -> dict:
    if not isinstance(settings, dict):
        raise ValueError("Invalid settings")
    cleaned = deepcopy(initial_settings())
    for name in ("jaw", "brow"):
        ch = settings[name]
        gpio = int(ch["gpio"])
        if gpio not in (17, 27, 23, 24, 25, 5, 6, 12, 13, 16, 26):
            raise ValueError("Select a supported servo GPIO, not an I²S pin")
        lo, hi = int(ch["min_us"]), int(ch["max_us"])
        if not (900 <= lo < hi <= 2100 and hi - lo >= 100):
            raise ValueError("Pulse endpoints must be within 900–2100 µs and ordered")
        cleaned[name] = {"gpio": gpio, "min_us": lo, "max_us": hi,
                         "invert": bool(ch.get("invert")), "rest": clamp(ch.get("rest", 0))}
    if cleaned["jaw"]["gpio"] == cleaned["brow"]["gpio"]:
        raise ValueError("Jaw and brow cannot use the same GPIO")
    cleaned["button_gpio"] = 22
    cleaned["audio_latency_ms"] = max(-250, min(500, int(settings.get("audio_latency_ms", 65))))
    device = str(settings.get("audio_device", "default"))[:64]
    if not device or not all(c.isalnum() or c in ("_", "-", ":", ".", ",", "=") for c in device):
        raise ValueError("Invalid ALSA output device")
    cleaned["audio_device"] = device
    cleaned["idle_motion"] = bool(settings.get("idle_motion", True))
    return cleaned


def load_json(path: Path, fallback: dict) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        atomic_json(path, fallback)
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def interpolate(keys: list, seconds: float, fallback: float) -> float:
    if not keys:
        return clamp(fallback)
    if seconds <= keys[0]["t"]:
        return clamp(keys[0]["v"])
    if seconds >= keys[-1]["t"]:
        return clamp(keys[-1]["v"])
    # Timelines are sorted on save.
    lo, hi = 0, len(keys) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if keys[mid]["t"] <= seconds:
            lo = mid
        else:
            hi = mid
    a, b = keys[lo], keys[hi]
    dt = b["t"] - a["t"]
    if dt <= 0:
        return clamp(b["v"])
    s = clamp((seconds - a["t"]) / dt)
    # A keyframe's ease describes the segment LEAVING that keyframe.
    ease = a.get("ease", "smooth")
    if ease == "hold":
        s = 0
    elif ease == "smooth":
        s = s * s * (3 - 2 * s)
    return clamp(a["v"] + (b["v"] - a["v"]) * s)


class ServoOutput:
    def __init__(self, enabled: bool, settings: dict):
        self.enabled = enabled
        self.settings = settings
        self.pi = None
        self.last = {"jaw": None, "brow": None}
        if enabled:
            try:
                import pigpio  # import only when hardware is enabled
            except ImportError as exc:
                raise RuntimeError("pigpio missing: sudo apt install python3-pigpio pigpio") from exc
            self.pi = pigpio.pi()
            if not self.pi.connected:
                raise RuntimeError("pigpiod unavailable. Start with: sudo pigpiod -t 0 (PWM clock, leaves PCM for I²S)")
            for ch in ("jaw", "brow"):
                self.pi.set_mode(settings[ch]["gpio"], pigpio.OUTPUT)

    def update_settings(self, settings: dict):
        old = self.settings
        if self.pi:
            for ch in ("jaw", "brow"):
                if old[ch]["gpio"] != settings[ch]["gpio"]:
                    self.pi.set_servo_pulsewidth(old[ch]["gpio"], 0)
        self.settings = settings
        self.last = {"jaw": None, "brow": None}

    def set(self, ch: str, value: float):
        spec = self.settings[ch]
        v = clamp(value)
        if spec["invert"]:
            v = 1 - v
        pulse = int(round(spec["min_us"] + (spec["max_us"] - spec["min_us"]) * v))
        if self.pi and (self.last[ch] is None or abs(self.last[ch] - pulse) >= 3):
            self.pi.set_servo_pulsewidth(spec["gpio"], pulse)
        self.last[ch] = pulse

    def close(self):
        if self.pi:
            for ch in ("jaw", "brow"):
                self.pi.set_servo_pulsewidth(self.settings[ch]["gpio"], 0)
            self.pi.stop()


class HatEngine:
    def __init__(self, hardware=False):
        AUDIO.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.project = load_json(PROJECT_FILE, initial_project())
        self.settings = validate_settings(load_json(SETTINGS_FILE, initial_settings()))
        self.hardware = hardware
        self.servos = ServoOutput(hardware, self.settings)
        self.busy = False
        self.playing = None
        self.position = 0
        self.error = None
        self.last_house = None
        self.manual = None
        self.manual_until = 0
        self.stop_event = threading.Event()
        self.close_event = threading.Event()
        self.audio_process = None
        self.worker = threading.Thread(target=self._run, daemon=True, name="hat-motion")
        self.worker.start()
        self.button = None
        if hardware:
            try:
                from gpiozero import Button
                self.button = Button(self.settings["button_gpio"], pull_up=True, bounce_time=0.25)
                self.button.when_pressed = self.start_ceremony
            except Exception as exc:
                self.error = f"Button unavailable: {exc}"

    def status(self) -> dict:
        with self.lock:
            return {"hardware": self.hardware, "busy": self.busy,
                    "playing": self.playing, "position": round(self.position, 3),
                    "last_house": self.last_house, "error": self.error,
                    "servo_pulses": dict(self.servos.last),
                    "audio_ready": shutil.which("aplay") is not None}

    def get_project(self):
        with self.lock:
            return deepcopy(self.project)

    def get_settings(self):
        with self.lock:
            return deepcopy(self.settings)

    def save_clip(self, clip_id, body):
        with self.lock:
            idx = next((i for i,c in enumerate(self.project["clips"]) if c["id"] == clip_id), None)
            if idx is None:
                raise ValueError("Unknown clip")
            validated = validate_clip(body, clip_id)
            # Audio filename controlled by uploader only, not by client payload.
            validated["audio"] = self.project["clips"][idx]["audio"]
            self.project["clips"][idx] = validated
            atomic_json(PROJECT_FILE, self.project)
            return deepcopy(validated)

    def save_settings(self, body):
        validated = validate_settings(body)
        with self.lock:
            if self.busy:
                raise ValueError("Stop playback before changing calibration")
            self.servos.update_settings(validated)
            self.settings = validated
            atomic_json(SETTINGS_FILE, validated)
        return deepcopy(validated)

    def set_uploaded_audio(self, clip_id: str, wav_path: Path, duration: float):
        with self.lock:
            clip = next((c for c in self.project["clips"] if c["id"] == clip_id), None)
            if clip is None:
                raise ValueError("Unknown clip")
            if not (0.1 <= duration <= 600):
                raise ValueError("Audio should be between 0.1 and 600 seconds")
            target = AUDIO / f"{clip_id}.wav"
            os.replace(wav_path, target)
            clip["audio"] = target.name
            clip["duration"] = duration
            for ch in ("jaw", "brow"):
                clip["tracks"][ch] = [
                    k for k in clip["tracks"][ch] if k["t"] <= duration
                ]
            atomic_json(PROJECT_FILE, self.project)
            return deepcopy(clip)

    def preview(self, jaw, brow):
        with self.lock:
            if self.busy:
                return False
            self.manual = {"jaw": clamp(jaw), "brow": clamp(brow)}
            self.manual_until = time.monotonic() + 0.4
            return True

    def start_clip(self, clip_id):
        with self.lock:
            if self.busy:
                return False
            if clip_id not in {c["id"] for c in self.project["clips"]}:
                raise ValueError("Unknown clip")
            self._start([clip_id])
            return True

    def start_ceremony(self):
        with self.lock:
            if self.busy:
                return False
            house = random.choice(HOUSES)
            self.last_house = house
            existing = {c["id"] for c in self.project["clips"]}
            self._start([c for c in ("intro", "ponder", "house_"+house) if c in existing])
            return True

    def _start(self, sequence):
        self.busy = True
        self.playing = None
        self.error = None
        self.stop_event.clear()
        self._queue = sequence

    def stop(self):
        self.stop_event.set()
        with self.lock:
            if self.audio_process is not None:
                try:
                    self.audio_process.terminate()
                except OSError:
                    pass

    def close(self):
        self.stop()
        self.close_event.set()
        self.worker.join(timeout=2)
        if self.button:
            self.button.close()
        self.servos.close()

    def _run(self):
        next_idle = time.monotonic() + 5
        brow_target = 0.5
        brow_current = 0.5
        while not self.close_event.is_set():
            with self.lock:
                sequence = getattr(self, "_queue", None)
                if sequence is not None:
                    del self._queue
            if sequence is not None:
                try:
                    for clip_id in sequence:
                        if self.stop_event.is_set():
                            break
                        self._play_clip(clip_id)
                except Exception as exc:
                    with self.lock:
                        self.error = f"Playback: {exc}"
                finally:
                    with self.lock:
                        self.busy = False
                        self.playing = None
                        self.position = 0
                    self.servos.set("jaw", self.settings["jaw"]["rest"])
                    self.servos.set("brow", self.settings["brow"]["rest"])
                continue
            now = time.monotonic()
            with self.lock:
                manual = self.manual if now < self.manual_until else None
                idle = self.settings["idle_motion"]
            if manual is not None:
                self.servos.set("jaw", manual["jaw"])
                self.servos.set("brow", manual["brow"])
            else:
                if now > next_idle:
                    brow_target = 0.5 + (random.uniform(-0.16, 0.18) if idle else 0)
                    next_idle = now + random.uniform(3, 7)
                brow_current += (brow_target - brow_current) * 0.035
                self.servos.set("jaw", self.settings["jaw"]["rest"])
                self.servos.set("brow", clamp(brow_current))
            time.sleep(0.03)

    def _play_clip(self, clip_id):
        with self.lock:
            clip = deepcopy(next(c for c in self.project["clips"] if c["id"] == clip_id))
            settings = deepcopy(self.settings)
            self.playing = clip_id
            self.position = 0
        wav = AUDIO / clip["audio"] if clip.get("audio") else None
        process = None
        if wav and wav.exists():
            if shutil.which("aplay") is None:
                raise RuntimeError("aplay is not installed; install alsa-utils on the Pi")
            process = subprocess.Popen(
                ["aplay", "-q", "-D", settings["audio_device"], str(wav)],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
        latency = settings["audio_latency_ms"] / 1000.0 if process else 0.0
        started = time.monotonic()
        with self.lock:
            self.audio_process = process
        try:
            while not self.stop_event.is_set():
                elapsed = time.monotonic() - started - latency
                if elapsed >= clip["duration"]:
                    break
                if process and process.poll() is not None and elapsed > 0.2:
                    if process.returncode:
                        msg = process.stderr.read().decode("utf-8", errors="replace")[:300]
                        raise RuntimeError("aplay failed: " + msg)
                    # ALSA process may exit a little before buffered sound finishes.
                if elapsed >= 0:
                    for ch in ("jaw", "brow"):
                        value = interpolate(clip["tracks"].get(ch, []), elapsed, settings[ch]["rest"])
                        self.servos.set(ch, value)
                    with self.lock:
                        self.position = elapsed
                time.sleep(0.02)
            if process and not self.stop_event.is_set():
                try:
                    process.wait(timeout=1.3)
                except subprocess.TimeoutExpired:
                    process.terminate()
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
            with self.lock:
                self.audio_process = None


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as f:
        if f.getcomptype() != "NONE":
            raise ValueError("Expected uncompressed PCM WAV")
        return f.getnframes() / f.getframerate()
