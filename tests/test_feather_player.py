"""CPython-only logic tests for the Feather CircuitPython player.

The firmware executes main() at import time on the board. To avoid touching
GPIO in CI, extract pure functions and small classes using the AST.
"""
import ast
import pathlib
import random
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "feather-rp2040" / "code.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
WANTED = {
    "clamp", "ease", "sample_track", "ceremony_ids",
    "Servo", "TriggerButton", "play_clip",
}


class FakeTime:
    now = 0.0

    @classmethod
    def monotonic(cls):
        return cls.now

    @classmethod
    def sleep(cls, dt):
        cls.now += dt


class FakePWM:
    def __init__(self, pin, *, frequency, duty_cycle):
        self.pin = pin
        self.frequency = frequency
        self.duty_cycle = duty_cycle
        self.removed = False

    def deinit(self):
        self.removed = True


class FakePin:
    value = True

    def __init__(self, pin):
        self.ident = pin
        self.value = True

    def deinit(self):
        pass


ENV = {
    "random": random,
    "time": FakeTime,
    "pwmio": types.SimpleNamespace(PWMOut=FakePWM),
    "board": types.SimpleNamespace(D4="pin4", D5="pin5", D9="pin9"),
    "digitalio": types.SimpleNamespace(
        DigitalInOut=FakePin,
        Direction=types.SimpleNamespace(INPUT="input"),
        Pull=types.SimpleNamespace(UP="up"),
    ),
    "gc": types.SimpleNamespace(collect=lambda: None),
}
extract = ast.Module(
    body=[node for node in TREE.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in WANTED],
    type_ignores=[],
)
exec(compile(extract, str(SOURCE), "exec"), ENV)
clamp, sample_track, ceremony_ids = (ENV[x] for x in ("clamp", "sample_track", "ceremony_ids"))


class MotionTests(unittest.TestCase):
    def test_linear_and_endpoints(self):
        keys = [
            {"t": 0, "v": 0.2, "ease": "linear"},
            {"t": 2, "v": 0.8, "ease": "linear"},
        ]
        self.assertAlmostEqual(sample_track(keys, -1), 0.2)
        self.assertAlmostEqual(sample_track(keys, 1), 0.5)
        self.assertAlmostEqual(sample_track(keys, 3), 0.8)

    def test_smooth_hold_and_duplicate_times(self):
        smooth = [
            {"t": 0, "v": 0, "ease": "smooth"},
            {"t": 1, "v": 1, "ease": "linear"},
        ]
        self.assertAlmostEqual(sample_track(smooth, 0.25), 0.15625)
        smooth[0]["ease"] = "hold"
        self.assertEqual(sample_track(smooth, 0.75), 0)
        duplicates = [
            {"t": 0, "v": 0.1, "ease": "linear"},
            {"t": 0, "v": 0.3, "ease": "linear"},
            {"t": 1, "v": 1, "ease": "linear"},
        ]
        self.assertTrue(0 <= sample_track(duplicates, 0.5) <= 1)
        self.assertEqual(sample_track([], 0.5, 0.42), 0.42)

    def test_ceremony_uses_one_house(self):
        clips = [{"id": n} for n in ["intro", "ponder", "house_a", "house_b"]]
        random.seed(11)
        ids = ceremony_ids(clips)
        self.assertEqual(ids[:2], ["intro", "ponder"])
        self.assertIn(ids[2], ["house_a", "house_b"])
        self.assertEqual(len(ids), 3)

    def test_pwm_conservative_mapping_and_inversion(self):
        cfg = {"pin": "D4", "rest": 0.0, "min_us": 1200, "max_us": 1750, "invert": False}
        servo = ENV["Servo"](cfg)
        self.assertEqual(servo.pwm.frequency, 50)
        self.assertEqual(servo.pwm.duty_cycle, int(1200 * 65535 / 20000))
        servo.set(1.0)
        self.assertEqual(servo.pwm.duty_cycle, int(1750 * 65535 / 20000))
        servo.invert = True
        servo.set(0.0)
        self.assertEqual(servo.pwm.duty_cycle, int(1750 * 65535 / 20000))
        servo.deinit()
        self.assertTrue(servo.pwm.removed)

    def test_button_debounced_press_and_release(self):
        FakeTime.now = 0
        button = ENV["TriggerButton"]("D9")
        button.pin.value = False
        self.assertFalse(button.pressed())
        FakeTime.now = 0.046
        self.assertTrue(button.pressed())
        self.assertFalse(button.pressed())
        button.pin.value = True
        self.assertFalse(button.pressed())
        FakeTime.now = 0.100
        self.assertFalse(button.pressed())
        button.pin.value = False
        self.assertFalse(button.pressed())
        FakeTime.now = 0.160
        self.assertTrue(button.pressed())

    def test_silent_clip_runs_motion_and_returns_home(self):
        FakeTime.now = 0
        config = {"jaw": {"pin":"D4","min_us":1200,"max_us":1750,"rest":0.0},
                  "brow": {"pin":"D5","min_us":1200,"max_us":1750,"rest":0.5}}
        jaw = ENV["Servo"](config["jaw"])
        brow = ENV["Servo"](config["brow"])
        log = []
        old_jaw = jaw.set
        def record(value):
            log.append(value)
            old_jaw(value)
        jaw.set = record
        button = types.SimpleNamespace(pressed=lambda: False)
        clip = {"id":"intro","duration":0.15,"tracks":{
            "jaw":[{"t":0,"v":0,"ease":"linear"},{"t":0.1,"v":1,"ease":"linear"}],
            "brow":[{"t":0,"v":0.5,"ease":"linear"},{"t":0.1,"v":0.8,"ease":"linear"}]}}
        played = ENV["play_clip"](clip, jaw, brow, button, None, {"audio_offset_ms":0})
        self.assertTrue(played)
        self.assertTrue(any(v > 0 for v in log))
        self.assertEqual(log[-1], 0.0)


if __name__ == "__main__":
    unittest.main()
