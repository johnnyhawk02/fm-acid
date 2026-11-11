// ---------- parts: ranges, real-value steps and the Mods page dials (the Options Circuit list was removed) ----------
function partRange(k) {
  const d = COMPONENTS[k];
  if (d.range) return d.range;
  return ['Ω', 'F', 'A'].includes(d.unit) ? [d.v / 10, d.v * 10, 'log'] : [d.v * 0.5, d.v * 1.5, 'lin'];
}
const SL = 1000;
function toSlider(k, v) {
  const [lo, hi, m] = partRange(k);
  const t = m === 'log' ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
  return Math.round(Math.min(1, Math.max(0, t)) * SL);
}
function fromSlider(k, x) {
  const [lo, hi, m] = partRange(k), t = x / SL;
  const v = m === 'log' ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t;
  return +v.toPrecision(3);
}
function drawPartKnob(k) {
  const t = COMPONENTS[k].fixed ? 0.5 : toSlider(k, state.parts[k]) / SL, h = cseqOn('p:' + k) ? cseqHeard('p:' + k, t) : -1;
  for (const el of document.querySelectorAll(`.knob[data-k="${k}"]`)) {
    knobDraw(el, t); knobHeard(el, h);
    el.setAttribute('aria-valuenow', Math.round(t * 100));
  }
}
function applyPart(k, val) {
  state.parts[k] = val;
  if (k === 'I_REF') queueMicrotask(drawTrim);
  if (k === 'KT' || k === 'R_KT') queueMicrotask(drawKeyTrack);
  for (const lab of document.querySelectorAll(`.val[data-k="${k}"]`)) { lab.textContent = fmt(val, COMPONENTS[k].unit); lab.classList.toggle('changed', partChanged(k, val)); }
  drawPartKnob(k);
  preview.setComponent(k, val); send({ type: 'component', name: k, value: cseqPartValue(k) });
  for (const id in knobEls) drawKnob(id); saveSession(); renderFx();
}
const partT = (k) => toSlider(k, state.parts[k]) / SL;
// real parts: resistors move in E24 steps and capacitors in E12, the values you can buy; Shift gives in-between values
const E24 = [1.0,1.1,1.2,1.3,1.5,1.6,1.8,2.0,2.2,2.4,2.7,3.0,3.3,3.6,3.9,4.3,4.7,5.1,5.6,6.2,6.8,7.5,8.2,9.1];
const E12 = [1.0,1.2,1.5,1.8,2.2,2.7,3.3,3.9,4.7,5.6,6.8,8.2];
const realSeries = (k) => { const d = COMPONENTS[k]; return ['schematic', 'td3', 'rat'].includes(d.source) && !d.fixed ? (d.unit === 'Ω' ? E24 : d.unit === 'F' ? E12 : null) : null; };
function seriesValues(k) {
  const E = realSeries(k), [lo, hi] = partRange(k), out = [];
  for (let dec = Math.floor(Math.log10(lo)) - 1; dec <= Math.ceil(Math.log10(hi)); dec++)
    for (const m of E) { const v = +(m * Math.pow(10, dec)).toPrecision(3); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  return out;
}
function snapReal(k, v) {
  if (!realSeries(k)) return v;
  let best = v, bd = Infinity;
  for (const x of seriesValues(k)) { const dd = Math.abs(Math.log(x / v)); if (dd < bd) { bd = dd; best = x; } }
  return best;
}
// one series step up or down from the current value (arrow keys)
function stepReal(k, dir) {
  const cur = state.parts[k], vs = seriesValues(k);
  const next = dir > 0 ? vs.find(x => x > cur * 1.001) : [...vs].reverse().find(x => x < cur * 0.999);
  if (next) applyPart(k, next);
}
function setPartT(k, t, free) { t = Math.min(1, Math.max(0, t)); const v = fromSlider(k, t * SL); applyPart(k, free ? v : snapReal(k, v)); }
// ---------- front-page mods ----------
const FRONT_MODS = [
  ['R_SOFT', 'Soft attack', 'fade-in on normal notes'],
  ['C35', 'Slide time', 'how long glides take'],
  ['R138', 'Short decay', 'fastest and accent decay'],
  ['R52', 'Note length', 'how long the VCA rings'],
  ['C_ACC', 'Accent sweep', 'how accents build up'],
  ['R72', 'Env depth', 'size of the filter sweep'],
  ['V_CUT', 'Cutoff range', 'how far the cutoff reaches'],
  ['A_Q21', 'Reso limit', 'up to self-oscillation'],
  ['R_IN', 'Drive', 'push the filter harder'],
  ['C18', 'Ladder cap', 'resonance character'],
  ['WOW', 'Accent wow', 'swell on accents at high reso'],
  ['NOISE', 'Noise', 'hiss of the old parts'],
].filter(([k]) => k in COMPONENTS);
const modsEl = document.getElementById('mods');
function renderFrontMods() {
  modsEl.innerHTML = FRONT_MODS.map(([k, name, desc]) => {
    const d = COMPONENTS[k], v = state.parts[k];
    const changed = partChanged(k, v) ? ' changed' : '';
    return `<div class="md" data-k="${k}" title="${k}: ${d.mod.replace(/"/g, '&quot;')}">
      <div class="knob" data-k="${k}" tabindex="0" role="slider" aria-label="${name} (${k})" aria-valuemin="0" aria-valuemax="100">${knobSVG()}</div>
      <span class="mname">${name}</span><span class="mdesc">${desc}</span>
      <span class="val${changed}" data-k="${k}" title="Click to reset to ${fmt(d.v, d.unit)}">${fmt(v, d.unit)}</span>
    </div>`;
  }).join('');
  for (const [k] of FRONT_MODS) drawPartKnob(k);
}
// small steps on a part with a real E-series walk the series; Shift (or a big step) moves freely along its range
const partNudge = (k, d, e) => { if (realSeries(k) && !e.shiftKey && Math.abs(d) < .05) stepReal(k, Math.sign(d)); else setPartT(k, partT(k) + d, e.shiftKey); };
bindDial(modsEl, {
  pick: (e) => e.target.closest('.knob[role=slider]'), get: partT, set: (k, t, e) => setPartT(k, t, e.shiftKey), nudge: partNudge,
  drag: 180, min: 0, max: 1, focus: true, reset: (k) => applyPart(k, COMPONENTS[k].v),
});
modsEl.addEventListener('click', (e) => {
  const lab = e.target.closest('.val'); if (!lab) return;
  const k = lab.dataset.k; if (COMPONENTS[k].fixed) return;
  applyPart(k, COMPONENTS[k].v);
});
