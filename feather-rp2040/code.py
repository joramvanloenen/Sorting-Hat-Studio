# Sorting Hat Studio — Adafruit Feather RP2040 (CircuitPython 9/10)
# Standalone MP3/WAV + two PWM servos + momentary button.
# Copy code.py, config.json, project.json and audio/ onto CIRCUITPY.
# No extra .mpy libraries are required.
import board
import digitalio
import pwmio
import audiobusio
import audiomp3
import audiocore
import json
import random
import time
import gc

CONFIG_PATH = "/config.json"
PROJECT_PATH = "/project.json"
DEFAULT_CONFIG = {
    "jaw": {"pin": "D4", "min_us": 1200, "max_us": 1750, "invert": False, "rest": 0.0},
    "brow": {"pin": "D5", "min_us": 1200, "max_us": 1750, "invert": False, "rest": 0.5},
    "button_pin": "D9",
    "audio_offset_ms": 0,
    "start_on_boot": False,
    "clip_gap_ms": 350
}

def clamp(x, lo=0.0, hi=1.0):
    return min(hi, max(lo, float(x)))

def load_json(path, default):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (OSError, ValueError) as exc:
        print("Cannot load", path, ":", exc)
        return default

def ease(u, mode):
    if mode == "hold":
        return 0.0
    if mode == "smooth":
        return u * u * (3.0 - 2.0 * u)
    return u

def sample_track(keys, t, rest=0.0):
    # Matches the browser / Raspberry Pi easing semantics.
    if not keys:
        return rest
    if t <= float(keys[0]["t"]):
        return clamp(keys[0]["v"])
    if t >= float(keys[-1]["t"]):
        return clamp(keys[-1]["v"])
    # Binary search: fine with thousands of audio-generated jaw keys.
    left, right = 0, len(keys) - 1
    while right - left > 1:
        mid = (left + right) // 2
        if float(keys[mid]["t"]) <= t:
            left = mid
        else:
            right = mid
    a, b = keys[left], keys[right]
    start = float(a["t"])
    span = float(b["t"]) - start
    if span <= 0.0:
        return clamp(b["v"])
    u = clamp((t - start) / span)
    return clamp(float(a["v"]) + (float(b["v"]) - float(a["v"])) * ease(u, a.get("ease", "linear")))

class Servo:
    PERIOD_US = 20000.0  # 50 Hz servo PWM
    def __init__(self, cfg):
        self.min_us = max(750.0, min(2250.0, float(cfg.get("min_us", 1200))))
        self.max_us = max(750.0, min(2250.0, float(cfg.get("max_us", 1750))))
        if self.max_us <= self.min_us:
            raise ValueError("Servo max_us must exceed min_us")
        self.rest = clamp(cfg.get("rest", 0.0))
        self.invert = bool(cfg.get("invert", False))
        self.pwm = pwmio.PWMOut(getattr(board, cfg["pin"]), frequency=50, duty_cycle=0)
        self.set(self.rest)
    def set(self, value):
        v = clamp(value)
        if self.invert:
            v = 1.0 - v
        pulse_us = self.min_us + v * (self.max_us - self.min_us)
        self.pwm.duty_cycle = int(pulse_us * 65535.0 / self.PERIOD_US)
    def home(self):
        self.set(self.rest)
    def deinit(self):
        self.pwm.deinit()

class TriggerButton:
    def __init__(self, pin_name):
        self.pin = digitalio.DigitalInOut(getattr(board, pin_name))
        self.pin.direction = digitalio.Direction.INPUT
        self.pin.pull = digitalio.Pull.UP
        self.raw = False
        self.stable = False
        self.changed_at = time.monotonic()
    def pressed(self):
        raw = not self.pin.value  # active-low button to GND
        now = time.monotonic()
        if raw != self.raw:
            self.raw = raw
            self.changed_at = now
        if raw != self.stable and now - self.changed_at >= 0.045:
            self.stable = raw
            return raw   # one event on each debounced press
        return False
    def deinit(self):
        self.pin.deinit()

def audio_sample(path):
    # Keep file handle open as long as the decoder is playing.
    source = open(path, "rb")
    try:
        if path.lower().endswith(".mp3"):
            return source, audiomp3.MP3Decoder(source)
        if path.lower().endswith(".wav"):
            return source, audiocore.WaveFile(source)
        raise ValueError("Only .mp3 and PCM .wav files are supported")
    except Exception:
        source.close()
        raise

def play_clip(clip, jaw, brow, button, audio, cfg):
    name = clip.get("id", "untitled")
    duration = max(0.0, float(clip.get("duration", 0.0)))
    # Feather exports keep each clip's keyframes in its own file so the
    # 264-KB-RAM RP2040 never has to parse every timeline at once.
    motion_path = clip.get("motion")
    if motion_path:
        if ".." in motion_path or motion_path.startswith("/"):
            raise ValueError("Unsafe motion path: " + motion_path)
        motion = load_json("/" + motion_path, {})
        tracks = motion.get("tracks") or {}
    else:
        tracks = clip.get("tracks") or {}
    jaw_keys = tracks.get("jaw") or []
    brow_keys = tracks.get("brow") or []
    source = None
    decoder = None
    audible = False
    filename = clip.get("audio")
    print("Playing:", name)
    try:
        if filename:
            # Editor-produced paths live inside audio/. Prevent escaping CIRCUITPY.
            if ".." in filename or filename.startswith("/"):
                raise ValueError("Unsafe audio path: " + filename)
            try:
                source, decoder = audio_sample("/" + filename)
                if audio is None:
                    raise RuntimeError("I2S amplifier not initialized")
                audio.play(decoder)
                audible = True
            except (OSError, ValueError, RuntimeError) as exc:
                print("Audio unavailable:", filename, exc)
                if source:
                    source.close()
                    source = None
                decoder = None
        start = time.monotonic()
        offset = float(cfg.get("audio_offset_ms", 0)) / 1000.0
        next_frame = start
        while time.monotonic() - start < duration:
            if button.pressed():
                print("Playback stopped by button")
                return False
            now = time.monotonic()
            t = max(0.0, now - start + offset)
            jaw.set(sample_track(jaw_keys, t, jaw.rest))
            brow.set(sample_track(brow_keys, t, brow.rest))
            # Motion uses a monotonic clock so decoding/USB logging does not
            # accumulate drift relative to audio playback.
            if audible and not audio.playing and now - start > 0.15:
                break
            next_frame += 0.02  # 50 animation updates per second
            pause = next_frame - time.monotonic()
            if pause > 0:
                time.sleep(min(pause, 0.02))
            else:
                next_frame = time.monotonic()
        return True
    finally:
        if audio is not None:
            audio.stop()
        # Release the decoder before closing its file.
        decoder = None
        gc.collect()
        if source:
            source.close()
        jaw.home()
        brow.home()

def ceremony_ids(clips):
    available = {c.get("id") for c in clips}
    houses = [c["id"] for c in clips if str(c.get("id", "")).startswith("house_") and c.get("id")]
    sequence = [name for name in ("intro", "ponder") if name in available]
    if houses:
        sequence.append(random.choice(houses))
    if not sequence and clips:
        sequence = [clips[0]["id"]]
    return sequence

def run_ceremony(project, jaw, brow, button, audio, config):
    clips = {clip["id"]: clip for clip in project.get("clips", []) if clip.get("id")}
    ids = ceremony_ids(list(clips.values()))
    if not ids:
        print("No clips found. Export a Feather pack from Sorting Hat Studio.")
        return
    print("Ceremony:", " -> ".join(ids))
    for i, clip_id in enumerate(ids):
        if not play_clip(clips[clip_id], jaw, brow, button, audio, config):
            break
        if i + 1 < len(ids):
            end = time.monotonic() + max(0.0, float(config.get("clip_gap_ms", 350))) / 1000.0
            while time.monotonic() < end:
                if button.pressed():
                    print("Ceremony stopped")
                    return
                time.sleep(0.02)
    print("Ready")

def main():
    config = load_json(CONFIG_PATH, DEFAULT_CONFIG)
    project = load_json(PROJECT_PATH, {"version": 1, "clips": []})
    jaw = brow = button = audio = None
    try:
        jaw = Servo(config["jaw"])
        brow = Servo(config["brow"])
        button = TriggerButton(config.get("button_pin", "D9"))
        try:
            audio = audiobusio.I2SOut(bit_clock=board.A0, word_select=board.A1, data=board.A2)
        except Exception as exc:
            print("I2S setup error:", exc, "(servos can still move silently)")
        print("Sorting Hat Feather ready. Press button (D9 to GND).")
        if config.get("start_on_boot", False):
            run_ceremony(project, jaw, brow, button, audio, config)
        while True:
            if button.pressed():
                run_ceremony(project, jaw, brow, button, audio, config)
            time.sleep(0.02)
    finally:
        if audio:
            audio.deinit()
        if button:
            button.deinit()
        if jaw:
            jaw.home()
            jaw.deinit()
        if brow:
            brow.home()
            brow.deinit()

try:
    main()
except Exception as error:
    print("Sorting Hat stopped:", repr(error))
    raise
