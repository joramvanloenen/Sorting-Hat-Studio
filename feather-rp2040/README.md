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

1. Download CircuitPython for **Feather RP2040** from [circuitpython.org/board/adafruit_feather_rp2040](https://circuitpython.org/board/adafruit_feather_rp2040/). Install the board-specific **UF2**: hold BOOTSEL while plugging USB into your Windows PC, then copy the UF2 to the **RPI-RP2** drive. The board should restart and show a **CIRCUITPY** drive.
2. Open the [Sorting Hat Studio browser editor](https://joramvanloenen.github.io/Sorting-Hat-Studio/). Import/edit dialogue and select **Export Feather**. The resulting ZIP holds the files below, including audio; extract its contents to the **root** of **CIRCUITPY**, not a subfolder.
3. Connect the servos and amp as above, provide a shared ground, and press a button wired between **D9 and GND**. The hat will play **one recording** identified by `clip_id` in `config.json`.
4. **Press again during playback to stop**. The player stays idle between recordings.
5. To make the hat speak as soon as power is applied, edit `config.json` and set `"start_on_boot": true`.

Folder layout of the ZIP:

```text
CIRCUITPY/
  code.py            # player — copied from this folder
  config.json        # pin mapping and servo calibration
  project.json       # small clip manifest (kept in RAM)
  motion/
    intro.json       # jaw/brow keyframes (loaded only when needed)
    ponder.json
    ...
  audio/
    intro.mp3
    ponder.mp3
    house_gryffindor.mp3
    ...
```

**No external Python libraries needed:** `audiobusio`, `audiomp3`, `audiocore`, `pwmio` and `digitalio` are built into the Feather's CircuitPython firmware. The browser exporter always creates validated mono **16-bit PCM WAV** (22,050 Hz by default). Even MP3/AAC/OGG source files are converted, avoiding incompatible MP3 formats on RP2040.

The default exported servo limits are **1200–1750 microseconds**. These are conservative initial values, but your particular linkages may need a smaller range. `config.json` includes `min_us`, `max_us`, `invert`, `rest` per servo, and optional `audio_offset_ms` for synchronization. **Do not attach the servos to the hat until they have been tested at their configured travel range.**

## Troubleshooting

- **No CIRCUITPY drive:** hold BOOTSEL while connecting USB to enter UF2 mode, install board-specific CircuitPython, use a USB **data** cable.
- **No sound:** confirm A0→BCLK, A1→LRC, A2→DIN, 3V→VIN, GND→GND, speaker to SPK+/SPK−. Verify the ZIP really contains `audio/` files.
- **Memory errors:** the Feather export deliberately stores animations as separate `motion/<clip>.json` files instead of loading all keyframes into RAM. Use the **Export Feather** feature rather than copying the Pi's much larger project.json directly.
- **Audio glitches:** use the editor's **Convert & listen** feature, then export again. 22.05 kHz PCM WAV is the recommended voice profile; 16 kHz Compact takes less flash space.
- **Random servo resets:** power servos from a dedicated regulated 5 V rail and join grounds.
- **Button does nothing:** check D9 ↔ GND and ensure `project.json` contains clips.
- **Can't fit ZIP on CIRCUITPY:** delete unused recordings or re-encode large MP3 clips. CircuitPython uses part of the 8 MB flash.
- **Debugging:** connect a serial terminal (e.g., Mu editor's Serial Console) while USB is connected to read `print()` messages and errors. Do not attach mechanical linkages for the first run.

**Validation note:** This firmware is written for the Feather RP2040 CircuitPython APIs and matches the existing project JSON format; it cannot be hardware-tested remotely. Validate the wiring and servo travel with the actual board before relying on it for a public performance.

## Behavior

- Fresh power-up: initializes output, enters ready mode without any Wi-Fi or Linux boot.
- Trigger press: plays only the clip selected with `"clip_id": "performance_1"` (or another clip ID) in `config.json`.
- During a clip: audio streams to the MAX98357A; jaw and brow values interpolate keyframes at approximately 50 updates/second. `linear`, `smooth`, and `hold` easing are respected.
- Trigger press during playback: immediately stops the recording and returns the servos to their configured rest positions.
- `start_on_boot=true`: optionally plays the selected recording on power-up. Leave false when using a brim switch.

The system measures animation time against the monotonic clock after starting the audio decoder. It is **not sample-clock synchronization**; use `audio_offset_ms` to adjust perceived timing if necessary.

**Editor export:** the one-click Feather ZIP now automatically sets `clip_id` to the currently selected editor performance. The bundled blank starter performance contains no speech until you import audio.

### Audio converter / amplifier test

The online studio converts recordings offline to signed 16-bit mono PCM WAV. **Convert & listen** auditions the exact WAV format used on the Feather. The selected recording is exported by default; the ZIP fails rather than silently omitting an unavailable audio file.

For a wiring test that does **not** need any audio file, edit `CIRCUITPY/config.json` and set `"test_tone_on_boot": true`. Reboot the Feather: it should play a short quiet **440 Hz beep** through MAX98357A. If that beep is silent, check VIN, GND, BCLK=A0, LRC=A1, DIN=A2 and the speaker connections (SPK+ / SPK−); converting recordings cannot fix an unpowered/disabled amplifier. Disable the test tone after confirming it works.

If `CIRCUITPY` lacks free space, export only one performance or select **16 kHz Compact**. Copy the ZIP contents to CIRCUITPY root, replacing the previous `code.py`, `config.json`, `project.json`, motion and audio files.
