# Developing 303 Circuit Model

Notes for working on the code. The user guide is [README.md](README.md). Product names below describe the circuits that were modelled; the app is not affiliated with their makers (see the README).

- `src/js/app/generate.js`: Generate and Refill make their patterns from scratch (a scale, a rhythm cell, slides and accents), then vary each bar. No stored patterns.
- `fonts/`: VT323 (SIL OFL, `fonts/OFL.txt`), served by the site and bundled in the plug-in, so nothing loads from Google.
- `install.sh` / `install.ps1`: the plug-in installers the release notes point to (curl on macOS and Linux, PowerShell on Windows). `TB303_BASE=file:///dir bash install.sh` installs from a local folder of zips for testing.
- `.github/workflows/plugin.yml`: builds the plug-in for macOS (VST3 + AU), Windows and Linux after every deploy and publishes release `v<N>`, N being the web app's version.

## Files
- `tb303-model.js`: the voice (`TB303Voice`) and its parts table (`COMPONENTS`). It has no dependencies and runs in Node, in a browser, or in an AudioWorklet.
- `tb303-model.js` also has `TB303Engine`, the player around the voice (knob slew, de-click, the step sequencer). The AudioWorklet and the main-thread fallback both run it.
- `src/`: the page source. `src/index.html` is the markup with slots; `src/css/` holds the styles by area, `src/js/worklet.js` the AudioWorklet wrapper, and `src/js/app/` the app by feature (sequencer, banks, knobs, parts, presets, MIDI and so on).
- `build.js`: `node build.js` fills the slots in `src/index.html` with the CSS, the model, the worklet, and the app code, and writes the single-file `index.html` that gets deployed. Edit `src/`, never `index.html`.
- `test.js`: sanity checks (DAC voltages, 110 Hz at the A key, filter range, decay times) and renders `demo.wav`.
- `factory-presets.json`: the Factory presets in the Preset menu, each a whole project (sound, effects, the 8 pattern slots and chain) in the format Export saves. `node build.js` puts it in the page. Its format is the `projectPresets` map of the file the Preset menu's Export all saves, so presets can be copied straight across.
- `icons/`: the install icons and favicon, all drawn by `node tools/make-icons.js` (the segmented dial in grey-LCD ink with the orange stop square). Edit the script and rerun it rather than editing the PNGs.
- `tests/golden.js`: the sound lock. It renders the two scenarios in `tests/` (`tests/render.js`) with the engine and checks they are bit-for-bit what `tests/golden.json` records, so a refactor can prove it changed nothing. When a change to the sound is meant, run `node tests/golden.js --update` and commit `tests/golden.json` with it.
- CI (`.github/workflows/check.yml`) runs on every push: `index.html` must match what `node build.js` makes, and the golden renders must match. The deploy builds `index.html` itself.
- `calib.js`: works out the ladder's self-oscillation gain (k = 17) and its resonance-frequency factor.

## What's modelled
- **Pitch CV:** a 6-bit R-2R ladder (100k/200k) from 5.333 V, which gives 1/12 V per step.
- **Slide:** an RC lag through R93 and C35.
- **VCO:** an exponential current charges C33 from 5.5 V to 12 V, then resets. The reset is smoothed with a polyBLEP.
- **Square:** the falling ramp drives the Q8 2SA733 PNP through R35 in parallel with C10 + R34. Q8 is an Ebers-Moll transistor solved by Newton each step, its emitter self-biases on C11 through R45, and the collector load goes to the 5.333 V rail, so the width, the 5.3 to 9 V swing and the sagging top all come from the circuit.
- **VCF:** the 4-pole transistor/diode ladder with an 18n bottom cap and 33n caps above it, and a tanh law for each transistor pair. It is solved with an implicit trapezoidal step at 2× oversampling. Resonance feedback is high-passed by C15.
- **Envelopes:** the filter envelope charges C62 and decays through R138 + VR6 (200 ms to 2.5 s). On accented notes VR6 is shorted and the accent sweep cap (1µ/47k) charges.
- **VCA:** an OTA fed through C49/R88. The resonance pot wiper is also mixed in through C76/R100 to compensate for lost bass.
- **Noise:** white voltage noise at the ladder input (EN_VCF), the OTA input (EN_OTA, the main hiss, which opens and closes with the VCA) and the output stage (EN_OUT, a constant floor). NOISE scales them all from 0 (silent) to 0.15 (the default: hiss around -80 dBFS under notes, -91 dBFS idle).

Each part's `source` field is `schematic`, `td3` or `estimate`.

## Effects
After the VCA there is an optional effect, modelled from its parts:
- **ProCo RAT:** an LM308 non-inverting stage limited by gain-bandwidth and slew rate (set by the 30p compensation cap). It then has 1N914 clipping diodes to ground, solved with Newton's method each sample, and the 1.5k + 100k / 3.3n filter.
- **Lexicon 224 (1978, David Griesinger):** a stereo reverb after the RAT. It runs on its own 20 kHz clock behind 6-pole anti-alias and reconstruction filters, with 12-bit gain-ranging converters (+24 dB), a zero-order-hold DAC, an input transformer, and 16-bit words in one shared 32K-word circular delay memory. Programs that don't fit are shrunk, as on the hardware. It has the nine v4.4 programs and the 224's controls: Bass and Mid decay (0.6–70 s) split at Crossover, Treble decay, Depth (0–71), Diffusion (0–63), each program's Predelay range, and Mode Enhancement (random tap modulation, Amount and Pitch). In Chorus A, eight voices wander at random and the first four knobs set the voice-pair levels.
  - **What is documented:** the program names, control ranges, sample rate, converters, word size and memory (the Lexicon v4.4 manual, the spec sheet, and Dattorro 1997, footnote 5).
  - **What is estimated:** Lexicon never published the 224's microcode. The core is the "plate-class topology in the style of Griesinger" that Jon Dattorro published (*Effect Design Part 1*, JAES 1997), using his delay lengths and output taps: input allpass diffusers feed a figure-eight tank. The hall, chamber, room and constant-density variants, the Depth mapping, the Mode Enhancement step timing, the chorus voice timings and the truncation rule are my estimates.
- **Plate, Spring and Convolution:** three more reverbs on the same slot, picked with the 224 / Plate / Spring / Conv switch (the Lexicon stays the default, so old sounds load as they were). They run clean at the host rate.
  - **Plate:** Jon Dattorro's published Griesinger-style plate (*Effect Design Part 1*, JAES 1997) as he gives it, with his delay lengths and taps: bandwidth filter, four input diffusers, the figure-eight tank with modulated allpasses. Five sizes scale every delay (Medium = his lengths). Predelay, Decay (0.3–20 s), Damping, Bandwidth, Low cut, Diffusion, Mod, Return.
  - **Spring:** a dispersive model after Välimäki, Parker and Abel (*Parametric spring reverberation effect*, JAES 2010): each spring is a feedback loop around its transit delay and 48 stretched first-order allpasses, so every echo smears into the falling drip chirp, cut off near 4.3 kHz like a real tank. One, two or three springs, or a long tank. Dwell (drive into the tank), Decay, Tension (chirp length), Tone, Low cut, Return.
  - **Convolution:** uniformly partitioned overlap-save FFT convolution in 512-sample blocks (the older partitions' work is spread across each block), up to 3 s. The impulse responses are generated from seeded noise (highs decay first, a density build-up and early reflections per space): Plate, Room, Chamber, Hall, Church and a 1980s gated one. Decay is applied per partition, so turning it costs nothing. Predelay (the one-block latency is the minimum), Decay (or Gate), Tone, Low cut, Width, Return.
- **Delay:** a clean digital delay on a parallel return, ping-pong by default (repeats alternate left and right; Mono puts them in the middle): tempo-synced Time (1/32 to 1/2, with dotted and triplet values), Feedback up to 95%, and a Low cut (20 Hz to 1 kHz) and High cut (1 to 20 kHz) inside the feedback loop, so each repeat gets thinner and darker.
- **Ducker:** a sidechain ducker (knob ids `cmp*`), on the delay and 224 returns and keyed from the dry synth. Two controls: **Amount** sets how deep the duck goes (0 = off, full duck from about 70%) and how easily it triggers (the synth level that ducks fully goes from -10 dB to -30 dB); **Release** (0 to 1 s) sets how fast the returns come back. Lookahead is fixed at 3 ms with a peak detector. With Release at 0 the gain follows the synth waveform (ring-mod sidechaining). The default and every factory preset is Amount 30%, Release 250 ms.

The drive, the delay, the Ducker and the reverb share the FX tab.

