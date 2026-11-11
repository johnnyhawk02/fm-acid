// ---------- the Sound column: Randomise, Alter, Undo ----------
// A whole new FM sound, or a small variation of this one, each set to the default sound's loudness (soundgen.js).
// The dials' step sequencers, the effects, Tuning, Volume, Accent and Slide time are left alone.
const sndUndo = [];
function syncSndUndo() { document.getElementById('snd-undo').disabled = !sndUndo.length; }
function applyFm(fm) { // a new set of FM parameters: show them and send them
  for (const p of FM_PARAMS) { const v = fmClean(p, fm[p.id] ?? p.def); if (v !== state.fm[p.id]) { state.fm[p.id] = v; sendFm(p.id); } }
  drawFmAll(); saveSession();
}
function newSound(make) {
  sndUndo.push({ ...state.fm }); if (sndUndo.length > 30) sndUndo.shift(); syncSndUndo();
  const keep = { accent: state.fm.accent, slide: state.fm.slide };
  applyFm(soundLevel({ ...make(state.fm), ...keep }));
}
document.getElementById('snd-rand').onclick = () => newSound(soundRandom);
document.getElementById('snd-alter').onclick = () => newSound(soundAlter);
document.getElementById('snd-undo').onclick = () => { const u = sndUndo.pop(); if (u) applyFm(u); syncSndUndo(); };
