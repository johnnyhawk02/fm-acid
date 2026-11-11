// ---------- the front panel ----------
// Tuning, then the FM voice's main dials, then Volume, then the Sound column. Tuning and Volume are dials of the app
// (knobs.js put them on the panel already); the rest are FM voice parameters (fm.js).
const PANEL_FM = [['algo', 'Algorithm'], ['fmLvl', 'FM'], ['fb', 'Feedback'], ['fmDecay', 'FM decay'], ['fCut', 'Cutoff'], ['fRes', 'Reso'], ['fEnv', 'Env mod'], ['fEnvDec', 'Decay'], ['accent', 'Accent']];
for (const [id, name] of PANEL_FM) fmDial(id, panel, name, { cls: 'kn', before: knobEls.volume.wrap });
// Sound: a new random sound, a small variation of this one, and undo (sound.js)
panel.insertAdjacentHTML('beforeend', `<div class="kn sound-kn"><span class="name">Sound</span>
  <button type="button" class="mini" id="snd-rand">Randomise</button>
  <button type="button" class="mini" id="snd-alter">Alter</button>
  <button type="button" class="mini" id="snd-undo" disabled>Undo</button></div>`);
