// ---------- tuning: a fine offset for each of the 12 notes, in cents, the same in every octave ----------
// The offsets add to the pitch CV (1 V/oct, so 1 cent = 1/1200 V) as each note starts; all 0 is the stock 303.
// They belong to the sound, so presets and the session keep them. The temperaments are laid out from a root note.
const TUNE_MAX = 100;
const tuneEl = document.getElementById('tu-faders'), tuneSeg = 20; // segments each side of the zero line, 5 cents each
const cents = (r) => 1200 * Math.log2(r);
// each system: cents above the root for the 12 notes of the scale
const TUNINGS = {
  just: { name: 'Just intonation', at: [1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 9/5, 15/8].map(cents) },
  pyth: { name: 'Pythagorean', at: [1, 256/243, 9/8, 32/27, 81/64, 4/3, 729/512, 3/2, 128/81, 27/16, 16/9, 243/128].map(cents) },
  // quarter-comma meantone: pure major thirds from fifths of 696.58 cents, from the flat third to the sharp fifth
  mean: { name: 'Quarter-comma meantone', at: Array.from({ length: 12 }, (_, i) => { const k = [0, 7, 2, -3, 4, -1, 6, 1, 8, 3, -2, 5][i]; return ((k * 1200 * Math.log2(5) / 4) % 1200 + 1200) % 1200; }) },
};
const tuneRound = (c) => Math.round(Math.min(TUNE_MAX, Math.max(-TUNE_MAX, c)) * 10) / 10;
let tuneRoot = Math.min(11, Math.max(0, store.get('tuneRoot', 9) | 0)), tuneSys = '';
const tuneUndo = [];
let tuneUndoAt = 0;
function pushTuneUndo(force) {
  const now = Date.now(); if (!force && now - tuneUndoAt < 1200) { tuneUndoAt = now; return; } // a run of wheel or key steps is one undo
  tuneUndoAt = now; tuneUndo.push([...state.tune]); if (tuneUndo.length > 50) tuneUndo.shift();
  document.getElementById('tu-undo').disabled = false;
}
function sendTune() { send({ type: 'tune', value: [...state.tune] }); }
function setTune(arr, sys = '') {
  state.tune = arr.map(tuneRound); tuneSys = sys; sendTune(); drawTune(); saveSession();
}
function tuneText(c) { return c === 0 ? '0 c' : (c > 0 ? '+' : '−') + Math.abs(c).toFixed(Number.isInteger(c) ? 0 : 1) + ' c'; }
tuneEl.innerHTML = NOTE.map((n, i) => `<div class="tu-col">
    <span class="val" data-k="${i}" title="Click to put ${n.toLowerCase()} back to 0">0 c</span>
    <div class="tu-bar" data-k="${i}" tabindex="0" role="slider" aria-label="${n} fine tune, cents" aria-valuemin="${-TUNE_MAX}" aria-valuemax="${TUNE_MAX}">${
      Array.from({ length: 2 * tuneSeg + 1 }, (_, j) => `<i data-s="${tuneSeg - j}"></i>`).join('')}</div>
    <span class="mname">${n.toLowerCase()}</span></div>`).join('');
const tuneCols = [...tuneEl.querySelectorAll('.tu-col')].map((col) => ({ val: col.querySelector('.val'), bar: col.querySelector('.tu-bar'), segs: [...col.querySelectorAll('i')] }));
function drawTune() {
  state.tune.forEach((c, i) => {
    const t = tuneCols[i], step = TUNE_MAX / tuneSeg;
    t.val.textContent = tuneText(c); t.val.classList.toggle('changed', c !== 0);
    t.bar.setAttribute('aria-valuenow', c); t.bar.setAttribute('aria-valuetext', tuneText(c).replace('c', 'cents'));
    for (const s of t.segs) { const j = +s.dataset.s; s.classList.toggle('on', j === 0 || (j > 0 ? c > (j - 1) * step : c < (j + 1) * step)); }
  });
  for (const b of document.querySelectorAll('#tu-root button')) b.setAttribute('aria-pressed', +b.dataset.r === tuneRoot);
  for (const b of document.querySelectorAll('#tu-sys button')) b.setAttribute('aria-pressed', b.dataset.t === tuneSys);
}
bindDial(tuneEl, {
  pick: (e) => e.target.closest('.tu-bar'), get: (k) => state.tune[k], drag: 1.2, fine: 12, step: 1, page: 10, min: -TUNE_MAX, max: TUNE_MAX, focus: true,
  start: () => pushTuneUndo(true),
  set: (k, c, e) => { const t = [...state.tune]; t[k] = e?.shiftKey ? c : Math.round(c); setTune(t); },
  nudge: (k, d, e) => { pushTuneUndo(); const t = [...state.tune]; t[k] = (e.shiftKey ? d / 10 : d) + t[k]; setTune(t); },
  reset: (k) => { const t = [...state.tune]; t[k] = 0; setTune(t); },
});
tuneEl.addEventListener('click', (e) => { const v = e.target.closest('.val'); if (!v) return; pushTuneUndo(true); const t = [...state.tune]; t[+v.dataset.k] = 0; setTune(t); });
// a temperament, laid out from the root note; Drift is a slightly out-of-tune old unit (each note a few cents off)
function applyTuning(sys) {
  if (sys === 'drift') { setTune(state.tune.map(() => (Math.random() + Math.random() + Math.random() - 1.5) * 8), ''); return; }
  const at = TUNINGS[sys].at;
  setTune(Array.from({ length: 12 }, (_, i) => { const d = (i - tuneRoot + 12) % 12; return at[d] - 100 * d; }), sys);
}
document.getElementById('tu-sys').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-t]'); if (!b) return;
  pushTuneUndo(true); applyTuning(b.dataset.t);
  sqSay(b.dataset.t === 'drift' ? 'Every note a few cents out, like an old unit.' : `${TUNINGS[b.dataset.t].name} from ${NOTE[tuneRoot].toLowerCase()}.`);
});
document.getElementById('tu-root').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-r]'); if (!b) return;
  tuneRoot = +b.dataset.r; store.set('tuneRoot', tuneRoot);
  if (tuneSys) { pushTuneUndo(true); applyTuning(tuneSys); } else drawTune(); // a temperament still as laid out follows the new root
});
document.getElementById('tu-reset').onclick = () => { if (state.tune.some(c => c)) pushTuneUndo(true); setTune(new Array(12).fill(0)); sqSay('Back to equal temperament.'); };
document.getElementById('tu-undo').onclick = () => {
  const u = tuneUndo.pop(); if (u) setTune(u);
  document.getElementById('tu-undo').disabled = !tuneUndo.length;
};
drawTune();
