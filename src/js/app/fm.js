// ---------- the FM voice's controls ----------
// Every FM parameter (FM_PARAMS in src/fm/fm-voice.js) is kept in real units in state.fm (Hz, ms, 0..1 amounts) and sent
// to the engine as a 'param' message. A dial moves along the parameter's own curve (fmToNorm / fmFromNorm), so its 0-1
// travel is what a step sequencer (ctlseq.js, key 'f:<id>') offsets. One parameter can have several controls on screen.
const fmP = (id) => FM_PARAMS[FM_P[id]];
const fmT = (id, v = state.fm[id]) => Math.min(1, Math.max(0, fmToNorm(fmP(id), v))); // the dial's travel, 0..1
const fmEls = {};  // id -> the dials showing it: { el, wrap, val }
const fmSync = {}; // id -> other controls showing it (seg groups, switches, menus, the algorithm diagram): redraw functions
const OPS = ['A', 'B', 'C', 'D'];
const FM_MS = new Set(['pDec', 'clkDec', 'nAtk', 'nDec', 'fEnvDec', 'aAtk', 'aHold', 'aDec', 'aRel', 'slide', ...OPS.flatMap(o => ['a' + o, 'd' + o])]);
const FM_SIGNED = new Set(['fb', 'fEnv', 'drift']);
function fmText(id, v) {
  const pc = (x) => Math.round(x * 100) + '%';
  if (FM_MS.has(id)) return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v >= 100 ? Math.round(v) + ' ms' : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') + ' ms' : v.toFixed(v < 1 ? 2 : 1) + ' ms';
  if (FM_SIGNED.has(id)) { const n = Math.round(v * 100); return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + '%'; }
  if (/^r[A-D]$/.test(id)) { // a fixed operator reads in Hz
    if (state.fm['fx' + id[1]] >= 0.5) { const hz = v * 1000; return hz >= 1000 ? (hz / 1000).toFixed(2) + ' kHz' : Math.round(hz) + ' Hz'; }
    return '×' + (v < 10 ? v.toFixed(2) : v.toFixed(1));
  }
  switch (id) {
    case 'algo': return FM_ALGOS[Math.round(v)];
    case 'fmDecay': return '×' + (v < 1 ? v.toFixed(2) : v.toFixed(1));
    case 'fCut': case 'nCut': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    case 'pAmt': return v.toFixed(1) + ' st';
    case 'kTrack': return v <= 0 ? 'off' : Math.round(v * 300) + '%'; // 100% = an octave of cutoff per octave of pitch
    case 'bits': return v >= 15.9 ? 'off' : v.toFixed(1) + ' bit';
    case 'srDiv': return v <= 1.01 ? 'off' : '÷' + v.toFixed(1);
    case 'lRate': return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + ' Hz';
  }
  return pc(v);
}
// the value the engine is given: the setting, or where a running step sequencer has moved it along the dial
function fmHeard(id) {
  const t = fmT(id), h = cseqHeard('f:' + id, t);
  return h === t ? state.fm[id] : fmFromNorm(fmP(id), h);
}
function drawFm(id) {
  const t = fmT(id), on = cseqOn('f:' + id), hv = fmHeard(id), txt = fmText(id, hv);
  for (const k of fmEls[id] || []) {
    knobDraw(k.el, t); knobHeard(k.el, on ? fmT(id, hv) : -1);
    k.el.setAttribute('aria-valuenow', Math.round(t * 100)); k.el.setAttribute('aria-valuetext', txt);
    k.val.textContent = txt;
  }
  for (const fn of fmSync[id] || []) fn();
}
function drawFmAll() { for (const p of FM_PARAMS) drawFm(p.id); }
function sendFm(id) { send({ type: 'param', name: id, value: fmHeard(id) }); }
function setFm(id, v) {
  const p = fmP(id); v = fmClean(p, v);
  if (v === state.fm[id]) return;
  state.fm[id] = v; drawFm(id); sendFm(id); saveSession();
}
// operator ratios land on the ratios FM is played with (quarters up to 4, halves above, and the low octaves); Shift moves freely
function fmSnapRatio(v) {
  if (v < 0.19) return 0.125; if (v < 0.375) return 0.25;
  const st = v < 4 ? 0.25 : 0.5; return Math.min(16, Math.round(v / st) * st);
}
// a dial for one parameter, added to host (before `before`, if given). cls: 'kn' the front panel's size, 'kn small' the pages'
function fmDial(id, host, name, { cls = 'kn small', before = null } = {}) {
  const p = fmP(id), steps = p.curve === 'int' ? p.max - p.min : 0, ratio = /^r[A-D]$/.test(id);
  const wrap = document.createElement('div'); wrap.className = cls;
  wrap.innerHTML = `<div class="knob" tabindex="0" role="slider" aria-label="${name}" aria-valuemin="0" aria-valuemax="100" data-f="${id}">${knobSVG()}</div>
    <div class="name">${name}</div><div class="val"></div>`;
  host.insertBefore(wrap, before);
  const el = wrap.querySelector('.knob');
  (fmEls[id] ||= []).push({ el, wrap, val: wrap.querySelector('.val'), name: wrap.querySelector('.name') });
  const put = (t, e) => { let v = fmFromNorm(p, t); if (ratio && !e?.shiftKey && state.fm['fx' + id[1]] < 0.5) v = fmSnapRatio(v); setFm(id, v); };
  bindDial(el, { get: () => fmT(id), set: (_, t, e) => put(t, e), min: 0, max: 1, reset: () => setFm(id, p.def), start: () => wrap.classList.add('active'),
    ...(steps && { step: 1 / steps, page: 1 / steps, drag: 110 }),
    ...(ratio && { nudge: (_, d, e) => { // arrows walk the snapped ratios
      if (e.shiftKey || state.fm['fx' + id[1]] >= 0.5) { put(fmT(id) + d, e); return; }
      const v = state.fm[id], st = d > 0 ? (v < 0.25 ? 0.125 : v < 4 ? 0.25 : 0.5) : (v <= 0.25 ? 0.125 : v <= 4 ? 0.25 : 0.5);
      setFm(id, fmSnapRatio(v + Math.sign(d) * st * (Math.abs(d) > 0.05 ? 4 : 1)));
    } }) });
  el.addEventListener('dialend', () => wrap.classList.remove('active'));
  return wrap;
}
// a row of buttons for a stepped parameter (filter type, LFO shape...): one lit
function fmSeg(id, host, names, label) {
  const seg = document.createElement('div'); seg.className = 'seg cmp-mode'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', label);
  seg.innerHTML = names.map((n, i) => `<button type="button" role="radio" data-v="${i}">${n}</button>`).join('');
  host.appendChild(seg);
  seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) setFm(id, +b.dataset.v); });
  (fmSync[id] ||= []).push(() => { for (const b of seg.children) b.setAttribute('aria-checked', +b.dataset.v === Math.round(state.fm[id])); });
  return seg;
}
// an on/off switch for a two-state parameter, with its label beside it
function fmSwitch(id, host, label) {
  const w = document.createElement('label'); w.className = 'fm-sw';
  w.innerHTML = `<button type="button" class="switch" role="switch" aria-checked="false" aria-label="${label}"><span class="thumb"></span></button><span>${label}</span>`;
  host.appendChild(w);
  const b = w.firstElementChild;
  b.onclick = () => setFm(id, state.fm[id] >= 0.5 ? 0 : 1);
  (fmSync[id] ||= []).push(() => b.setAttribute('aria-checked', state.fm[id] >= 0.5));
  return w;
}
