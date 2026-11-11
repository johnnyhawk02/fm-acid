# 303 Circuit Model

A free acid bass synth, modelled part by part from the original 1982 bass line circuit: the pitch ladder, the
oscillator's transistor, the four-pole ladder filter, the envelopes and the VCA, each from its schematic values. Around
it: a 64-step pattern sequencer with slides and accents, a step sequencer for any dial, a wavefolder, three drive
pedals, a flanger, a tempo-synced delay, four kinds of reverb and a ducker.

It runs in your browser and as a plug-in, with the same sound and the same screen.

## Play it in the browser

**https://tb303-circuit-model.pages.dev**

Works in Chrome, Edge and Safari on a computer or tablet; Firefox works too. Install it as an app from Options › About
to use it offline. MIDI keyboards and controllers work in Chrome and Edge (Options › MIDI).

The small **Seq** button next to Play turns the step sequencer on and off. With it off the synth is a mono MIDI synth:
notes play it directly (A2 = 110 Hz), velocity 100 and up is an accent, and a note played while another is held slides
to it, as on the 303. It works the same way in the plug-in, where the setting is saved with the project.

## The plug-in

| | Formats | Install |
|---|---|---|
| **Mac** (Apple Silicon and Intel, macOS 11+) | VST3, AU | In Terminal: `curl -fsSL https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.sh \| bash` |
| **Windows** (10/11, 64-bit) | VST3 | In PowerShell: `irm https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.ps1 \| iex` |
| **Linux** (x86_64) | VST3 | In a terminal: `curl -fsSL https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.sh \| bash` |

Then rescan plug-ins in your DAW. Run the same command again to update. To remove it on Mac or Linux, add
`-s -- --uninstall` after `bash`; on Windows delete `C:\Program Files\Common Files\VST3\303 Circuit Model.vst3`.
Every version is on the [releases page](https://github.com/johnnyhawk02/tb303-circuit-model/releases).

Why a command and not a download? The Mac plug-in is not notarised by Apple, so a file downloaded in a browser is
blocked as "damaged". Fetched with `curl` it is not, and nothing else is changed on your system. The script is short:
read it first if you like ([install.sh](install.sh), [install.ps1](install.ps1)).

- **Needs:** on Windows the Microsoft Edge WebView2 Runtime (built into Windows 11 and up-to-date Windows 10; the
  installer tells you if it is missing). On Linux WebKitGTK 4.1 (`libwebkit2gtk-4.1-0` on Debian/Ubuntu).
- **The DAW runs it:** play, stop and tempo follow the DAW, and the pattern locks to its bar grid. There is no Play
  button or Tempo dial in the plug-in.
- **Automation:** every dial, the effect switches, the wave switch and the pattern slot are DAW parameters.
- **MIDI notes** (C3 = middle C = 60): C0-G0 pick patterns 1-8; C1-C3 transpose the pattern (C1 = as written).
  With **Seq** off, every note plays the synth instead and the DAW transport doesn't start the pattern.
- **Saving:** the DAW project keeps the sound, the patterns and the chain. Your presets, favourites and colours are
  shared by every copy of the plug-in, in `~/Library/Application Support/303 Circuit Model` (Mac),
  `%APPDATA%\303 Circuit Model` (Windows) or `~/.config/303 Circuit Model` (Linux).

### Known limits

- MIDI CC (controller knobs mapped in Options › MIDI) only reaches the plug-in while its window is open. DAW
  automation and MIDI notes work with it closed.
- So far tested mainly on a Mac. Reports from other DAWs and systems are welcome.
- The heaviest settings (convolution reverb plus every effect) want a reasonably recent computer.

## Keys

Space plays (browser only). 1-8 pick a pattern. G generates a new pattern, Shift+G refills the other slots. A, S and O
randomise accents, slides and octaves (Shift alters them instead). R and T open the Randomise and Tools menus, E the
Gate menu. Cmd/Ctrl+C, V and Z copy, paste and undo the pattern. Long-press or right-click any dial for its own step
sequencer.

## Bugs and ideas

Open an issue: https://github.com/johnnyhawk02/tb303-circuit-model/issues. Please say which version (top bar), which
browser or DAW, and what you did.

## Privacy

No accounts, no tracking, no analytics. Nothing you make leaves your computer: the web app keeps everything in your
browser's storage, and the plug-in in the folder named above. The font is served from this site, not Google.

## Licence and credits

Free software under the [GNU Affero General Public License v3](LICENSE): use it, share it and change it; if you
publish a changed version, publish its source too. It comes with no warranty.

- Impulse responses: plate IRs by Greg Hopkins (CC BY), room IRs from Voxengo (free for any use). Details in
  [irs/CREDITS.md](irs/CREDITS.md).
- Font: VT323 by Peter Hull, SIL Open Font License ([fonts/OFL.txt](fonts/OFL.txt)).
- Plug-in built with [JUCE](https://juce.com) (AGPLv3) and the Steinberg VST3 SDK (MIT). VST is a registered
  trademark of Steinberg Media Technologies GmbH.
- The reverbs follow published research: Jon Dattorro's plate (JAES 1997), Välimäki, Parker and Abel's spring
  (JAES 2010), and Esqueda, Pöntynen, Parker and Bilbao's wavefolder (DAFx-17).

**Trademarks.** Not affiliated with or endorsed by Roland, Behringer or the makers of any gear it is modelled on.
Product names belong to their owners and are mentioned only to describe the circuits that were modelled.

Working on the code? See [DEVELOPING.md](DEVELOPING.md).
