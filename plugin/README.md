# 303 Circuit Model VST3

The web app as a VST3 instrument for macOS, built only from the web app in this repo.

- **Looks the same:** its screen is the web app's own page (`index.html`, made by `node build.js`) in a web view, at the
  same 1000 x 647 size, scaling as the window is resized. The only differences: there is no Play button or Tempo dial,
  because the DAW's transport and tempo run it, and the VT323 font comes from the plug-in instead of Google Fonts.
- **Sounds the same:** `engine/` is a line-for-line C++ port of `tb303-model.js` (the voice, effects, reverbs,
  knob slew, de-click and step sequencer). `tests/parity.js` renders the two golden sound-lock scenarios in `tests/`
  with both engines and compares them sample by sample; it fails if any sample differs by more than -90 dBFS. At the
  time of the port 99.4% of the samples were bit-identical and the worst difference was -144 dBFS. The engine must be
  built with `-ffp-contract=off` and without fast-math, so its arithmetic matches JavaScript's.
- **Plays from the DAW:** play and stop follow the transport, the tempo follows the DAW's tempo, and the steps land on
  the DAW's 16th-note grid counted from the start of the song (so the pattern's step 1 falls on bar 1, and loops and
  jumps stay in time). MIDI CC from the track drives the page's MIDI map (Options > MIDI) while the screen is open. Notes (C3 = 60)
  pick the pattern, C0-G0 = slots 1-8, and C1-C3 set the root note the pattern plays from (C1 = as written), with the
  window open or shut.
- **Automation:** every knob (named as on the screen, with its unit in front), the effect On switches and the wave switch
  and a Pattern parameter (slots 1-8) are DAW parameters (generated into `engine/tables.h` from `src/js/app/state.js`). Automation moves the controls on
  the screen and plays with the window shut; moving a control on the screen records automation.
- **Saves with the project:** the plug-in keeps the latest engine message of each kind and the page's project state
  (session, pattern slots, chain) in the DAW project, so it sounds right even before its window is opened. Presets,
  favourites and colours are shared by every instance in `~/Library/Application Support/303 Circuit Model/storage.json`.
  Export buttons open a save dialog.

## Keeping it in step with the web app

The page needs nothing: every build takes the current `index.html`. A change to the sound (anything in
`tb303-model.js` that `tests/golden.js` notices) needs the same change in `engine/`; the plug-in workflow's parity
check fails until it is ported. New knobs and parts come across by themselves: `node plugin/tools/gen-tables.js`
regenerates `engine/tables.h` from `tb303-model.js` (the workflow checks it is current).

## Build

`.github/workflows/plugin.yml` builds it on a macOS runner after every Cloudflare deploy of main and publishes
`303-Circuit-Model-VST3-mac.zip` (Apple Silicon and Intel) on the `plugin-latest` release, with the web app's version
shown in the top bar. By hand:

    node build.js && node plugin/tools/make-page.js plugin/build/page dev
    cmake -S plugin -B plugin/build -DCMAKE_BUILD_TYPE=Release
    cmake --build plugin/build --config Release

Install: unzip, move `303 Circuit Model.vst3` to `~/Library/Audio/Plug-Ins/VST3`, and clear the download quarantine
(it is signed ad hoc, not notarised):

    xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/303\ Circuit\ Model.vst3

`tests/host/` is a small VST3 host for testing on Linux: it plays the plug-in from a fake transport, compares the
result with the JS engine (`state-render.js`) and opens the screen to check the page talks to the plug-in.
