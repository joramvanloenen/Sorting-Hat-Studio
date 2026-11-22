# Feather RP2040 player for Sorting Hat Studio

This is **standalone CircuitPython firmware** for the **original Adafruit Feather RP2040** (8 MB flash). It boots without Linux or Wi-Fi. The same [Sorting Hat Studio editor](https://joramvanloenen.github.io/Sorting-Hat-Studio/) exports the audio and jaw/brow keyframes.

## Wiring (Feather pin labels, **not Raspberry Pi GPIO numbers**)

| Connect | Feather RP2040 | Notes |
| --- | --- | --- |
| Jaw SG90 signal (orange/yellow) | **D4** (GP6) | PWM signal only |
| Brow SG90 signal | **D5** (GP7) | PWM signal only |
| Trigger button | **D9** (GP9) ↔ **GND** | Internal pull-up; no resistor |
| MAX98357A BCLK | **A0** (GP26) | I²S clock |
| MAX98357A LRC | **A1** (GP27) | I²S word select |
| MAX98357A DIN | **A2** (GP28) | I²S data |
| MAX98357A VIN | **3V** | 3.3 V amplifier supply, lower output power than 5 V |
| MAX98357A GND | **GND** | Common ground |
| MAX98357A SPK+ / SPK− | Speaker terminals | 4–8 Ω passive speaker; **neither terminal is ground** |
| Two servo red wires | External regulated **5 V** | Prefer 2 A or more for the two motors |
| Two servo brown wires | External servo supply GND | **Connect this GND to Feather GND** |

Do not attach servo motors to the Feather 3V pin; **never put 5 V on Feather GPIO**. Test without the mechanical linkages first. If your amplifier has GAIN/SD pins, leave them at breakout defaults for initial testing.

**Pin references:** [Adafruit Feather RP2040 pinouts](https://learn.adafruit.com/adafruit-feather-rp2040-pico/pinouts) and [Adafruit MAX98357A I²S wiring](https://learn.adafruit.com/circuitpython-text-to-speech/feather-max98357a-wiring).

## Install and run

1. Install [CircuitPython for Adafruit Feather RP2040](https://circuitpython.org/board/adafruit_feather_rp2040/) by copying the board-specific UF2 to the **RPI-RP2** bootloader drive. The Feather will restart as the **CIRCUITPY** USB drive.
2. Open [Sorting Hat Studio](https://joramvanloenen.github.io/Sorting-Hat-Studio/), import dialogue recordings and edit the jaw/brow animations. Their order in the Performances list determines playback order.
3. Click **Export Feather**. The ZIP includes **every performance with audio**, each with its WAV and jaw/brow motion; empty/no-audio performances are skipped. The editor's Voice Character preset and bass perception processing are rendered into each WAV.
4. Before transferring a new pack, delete the old `audio/` and `motion/` folders from CIRCUITPY to reclaim space and avoid stale files. Extract the ZIP contents directly into the **root** of CIRCUITPY, replacing `code.py`, `config.json` and `project.json`.
5. Connect the amplifier, speaker and both SG90 servos according to the wiring table above. The trigger is a momentary button wired between **D9 and GND**. Give the servos their own suitably rated 5V supply with shared GND.

### Button behavior

| Action | Playback |
| --- | --- |
| First press | First recording |
| Subsequent presses | Next recording in library order |
| Press during playback | Skip immediately to the next recording |
| Press after the last recording | Wrap to the first recording |
| Switch power off/on | Restart at the first recording |

**Only one recording plays per press.** There is no ceremony mode, automatic multi-clip chain or random house selection.

In `config.json`, `"start_on_boot": true` starts the first recording automatically as soon as the controller has initialized, then button presses advance through the library. The default is `false`, meaning the hat starts silent.

### Files in the ZIP

```text
CIRCUITPY/
  code.py               # standalone Feather player
  config.json           # servo calibration, button and power-on settings
  project.json          # all recorded performances, in library order
  motion/
    recording_one.json  # jaw + eyebrow keyframes for #1
    recording_two.json  # jaw + eyebrow keyframes for #2
  audio/
    recording_one.wav   # processed PCM16 mono audio for #1
    recording_two.wav   # processed PCM16 mono audio for #2
  README.txt
```

No extra libraries are required: CircuitPython already includes `audiobusio`, `audiocore`, `pwmio` and `digitalio`. MP3 and other source formats are converted by the browser to validated **16-bit PCM mono WAV** (22.05 kHz by default). Only one clip's motion keyframes are loaded at a time to conserve RP2040 RAM.

### Storage limits

The original Feather RP2040 has **8 MB physical flash**, part of which is occupied by CircuitPython. The editor checks that the ZIP's *uncompressed files* use no more than approximately **5.9 MiB**. At 22.05 kHz/16-bit/mono, audio alone uses approximately 44.1 KB per second. If multiple recordings won't fit, change **Voice quality** to **16 kHz Compact**, shorten/remove some recordings, or add external storage in a later hardware revision. Always delete old WAVs/motion files before installing a new export.

### Sound / hardware troubleshooting

- **Silent output:** In `config.json` set `"test_tone_on_boot": true` and reboot to play a short, quiet 440 Hz tone. If that's silent, check the amplifier power, shared ground, I²S wiring and speaker terminals. Set this flag back to false after testing.
- **Audio quality:** Use **Convert & listen** in the online editor. Feather export retains the same Voice Character processing.
- **Button doesn't advance:** Check D9 ↔ GND (internal pull-up) and verify that `project.json` contains multiple clips with `audio` paths.
- **New ZIP doesn't fit:** Remove the old `audio/` and `motion/` folders first. ZIP compression makes the download smaller than the actual extracted WAV files.
- **Debugging:** Use the USB serial console to see the currently playing recording and any decoder errors.
- **Servos:** Do not connect servo 5 V wires to the Feather 3 V pin; test travel range before attaching the mechanical linkages.

**Validation:** Automated tests cover clip order, wrapping, button interruptions and WAV packaging. Actual audio volume and mechanical travel still need testing on your physical board.
