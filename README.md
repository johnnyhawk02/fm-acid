# FM Acid

A free FM bass and lead synth for acid lines. One four-operator FM voice, played by a 64-step pattern sequencer with
slides and accents. Around it: a step sequencer for any dial, a wavefolder, three drive pedals, a flanger, a
tempo-synced delay, four kinds of reverb and a ducker.

It runs in your browser.

## Play it

**https://fm-acid.pages.dev**

Works in Chrome, Edge and Safari on a computer or tablet; Firefox works too. Install it as an app from Options › About
to use it offline. MIDI keyboards and controllers work in Chrome and Edge (Options › MIDI).

- **Front panel:** Tuning, Algorithm, FM, Feedback, FM decay, Cutoff, Reso, Env mod, Decay, Accent and Volume, then
  **Sound**: Randomise makes a new sound, Alter nudges this one, Undo steps back.
- **Operators:** the four operators (Ratio, Level, Attack, Decay, and a Fixed switch that holds an operator at its own
  frequency), a diagram of the algorithm, and the controls that act on all four.
- **Shape:** pitch envelope, click, noise, filter extras, amp envelope, bit crusher, LFO and what an accent changes.
- **FX** and **Tuning:** the effects and a per-note fine tuning.
- **Preset menu:** factory presets, your own, favourites, export and import. Preset files from the earlier acid bass
  synth app load too: their patterns, chain and effects come in, with the default FM sound.

The small **Seq** button next to Play turns the step sequencer on and off. With it off the synth is a mono MIDI synth:
notes play it directly (A2 = 110 Hz), velocity 100 and up is an accent, and a note played while another is held slides
to it. With it on, MIDI notes C0-G0 pick patterns 1-8 and C1-C3 transpose the pattern (C1 = as written).

## Keys

Space plays. 1-8 pick a pattern. G generates a new pattern, Shift+G refills the other slots. A, S and O randomise
accents, slides and octaves (Shift alters them instead). R and T open the Randomise and Tools menus, E the Gate menu.
Cmd/Ctrl+C, V and Z copy, paste and undo the pattern. Long-press or right-click any dial for its own step sequencer.

## Bugs and ideas

Open an issue: https://github.com/johnnyhawk02/fm-acid/issues. Please say which version (top bar), which browser, and
what you did.

## Privacy

No accounts, no tracking, no analytics. Nothing you make leaves your computer: the app keeps everything in your
browser's storage. The font is served from this site, not Google.

## Licence and credits

Free software under the [GNU Affero General Public License v3](LICENSE): use it, share it and change it; if you
publish a changed version, publish its source too. It comes with no warranty.

- The FM voice (`src/fm/fm-voice.js`) comes from Johnny's FM drum machine fm/dm and keeps its MIT licence; the notice
  is at the top of that file.
- Impulse responses: plate IRs by Greg Hopkins (CC BY), room IRs from Voxengo (free for any use). Details in
  [irs/CREDITS.md](irs/CREDITS.md).
- Font: VT323 by Peter Hull, SIL Open Font License ([fonts/OFL.txt](fonts/OFL.txt)).
- The effects follow published research: Jon Dattorro's plate (JAES 1997), Välimäki, Parker and Abel's spring
  (JAES 2010), and Esqueda, Pöntynen, Välimäki and Parker's wavefolder (DAFx-17).

**Trademarks.** Not affiliated with or endorsed by the makers of any gear the effects are modelled on. Product names
belong to their owners and are mentioned only to describe the circuits that were modelled.

Working on the code? See [DEVELOPING.md](DEVELOPING.md).
