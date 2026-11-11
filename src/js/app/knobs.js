// ---------- knobs ----------
const panel = document.getElementById('panel');
const KNOB_A0 = -150, KNOB_SWEEP = 300; // dial travel in degrees, 0 = straight up
// Dial look (Johnny, from his reference): a ring of separate wedge segments that light up to the value, ghost where unlit,
// the readout above and the label below. No pointer line and no centre number.
const KNOB_SEGS = 24, KNOB_RI = 17.5, KNOB_RO = 28.5, KNOB_GAP = 2.6; // segments round the 300° sweep; viewBox is 64 units
const knobAngle = (p) => KNOB_A0 + KNOB_SWEEP * Math.min(1, Math.max(0, p));
const segPath = (i) => {
  const w = KNOB_SWEEP / KNOB_SEGS, a0 = KNOB_A0 + i * w + KNOB_GAP / 2, a1 = KNOB_A0 + (i + 1) * w - KNOB_GAP / 2;
  const pt = (deg, r) => { const t = (deg - 90) * Math.PI / 180; return `${(32 + r * Math.cos(t)).toFixed(2)} ${(32 + r * Math.sin(t)).toFixed(2)}`; };
  return `M${pt(a0, KNOB_RO)}A${KNOB_RO} ${KNOB_RO} 0 0 1 ${pt(a1, KNOB_RO)}L${pt(a1, KNOB_RI)}A${KNOB_RI} ${KNOB_RI} 0 0 0 ${pt(a0, KNOB_RI)}Z`;
};
const SEG_ALL = Array.from({ length: KNOB_SEGS }, (_, i) => segPath(i));
const SEG_LIT = SEG_ALL.map((_, i) => SEG_ALL.slice(0, i + 1).join(''));
// segments lit for a value: none at 0, all at 1
const arcPath = (p) => { const n = Math.round(Math.min(1, Math.max(0, p)) * KNOB_SEGS); return n ? SEG_LIT[n - 1] : ''; };
function knobSVG() {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path class="trk" d="${SEG_ALL.join('')}"/>
    <path class="arc" d=""/>
    <path class="hrd" d=""/>
  </svg>`;
}
// redraw one dial's ring for a 0-1 position
function knobDraw(el, p) {
  el.querySelector('.arc').setAttribute('d', arcPath(p));
}
// a dial with a step sequencer (ctlseq.js): the ring stays at the dial's own setting, and an ink pointer outside the ring
// shows where the sequence has moved it (at the setting when stopped); p < 0 hides the pointer
function knobHeard(el, p) {
  const h = el.querySelector('.hrd'); if (!h) return;
  if (p < 0) { h.setAttribute('d', ''); return; }
  const a = knobAngle(p), pt = (deg, r) => { const t = (deg - 90) * Math.PI / 180; return `${(32 + r * Math.cos(t)).toFixed(2)} ${(32 + r * Math.sin(t)).toFixed(2)}`; };
  h.setAttribute('d', `M${pt(a, 29.5)}L${pt(a - 11, 40)}L${pt(a + 11, 40)}Z`);
}
function knobText(id, p) {
  const c = state.parts;
  switch (id) {
    case 'tuning': return ((p - 0.5) * 2 >= 0 ? '+' : '') + ((p - 0.5) * 24).toFixed(1) + ' st';
    case 'cutoff': return (preview.wCut * c.V_CUT * p * 1000).toFixed(1) + ' mV';
    case 'resonance': return 'k = ' + (c.A_Q21 * p).toFixed(1);
    case 'decay': return fmt(c.R138 + c.VR6 * Math.pow(p, 2.74), 'Ω');
    case 'dist': return '×' + Math.round(1 + (c.RAT_RD * Math.pow(p, 2.74) + 1) * (1 / c.RAT_RG1 + 1 / c.RAT_RG2));
    case 'filter': return fmt(Math.round(1 / (2 * Math.PI * (c.RAT_RF + 100e3 * p) * c.RAT_CFLT)), 'Hz');
    case 'dlytime': return dlyDiv(p)[0];
    case 'dlyfb': return Math.round(95 * p) + '%';
    case 'dlylo': return fmt(Math.round(dlyLo(p)), 'Hz');
    case 'dlyhi': { const f = dlyHi(p); return f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz'; }
    case 'cmpamt': return p <= 0 ? 'off' : Math.round(100 * p) + '%';
    case 'cmprel': return Math.round(cmpRelMs(p)) + ' ms';
    case 'dsdist': return '×' + Math.round(1 + PEDAL_PARTS.DS_VR1 * p / PEDAL_PARTS.DS_R13);                    // op-amp stage gain
    case 'tsdrive': return '×' + Math.round(1 + (PEDAL_PARTS.TS_R6 + PEDAL_PARTS.TS_P1 * Math.pow(p, 2.74)) / PEDAL_PARTS.TS_R4);
    case 'fldtimbre': return (0.5 + 9.5 * p * p).toFixed(1) + ' V';   // peak at the folding cells for a full-level note
    case 'flgman': return flgMs(state.knobs.flgmode >= 0.5 ? 0.55 + 0.45 * p : p).toFixed(1) + ' ms'; // the BBD delay at the centre of the sweep
    case 'flgrate': { const f = flgRate(p); return (f < 1 ? f.toFixed(2) : f.toFixed(1)) + ' Hz'; }
    case 'fldsym': { const v = (p - 0.5) * 4; return (v >= 0 ? '+' : '') + v.toFixed(1) + ' V'; }
    default: {
      if (id.startsWith('lex')) return lexText(id, p);
      if (/^(plate|spr|cnv)/.test(id)) return revText(id, p);
      return Math.round(p * 100) + '%';
    }
  }
}
function lexText(id, p) {
  const q = lexParams({ ...state.knobs, [id]: p }), sec = (t) => (t < 10 ? t.toFixed(2) : t.toFixed(1)) + ' s';
  const hz = (f) => f >= 10000 ? 'off' : f >= 1000 ? (f / 1000).toFixed(f < 10000 ? 2 : 1) + ' kHz' : Math.round(f) + ' Hz';
  const chorus = q.P.alg === 'chorus';
  switch (id) {
    case 'lexprog': return 'P' + q.P.n;
    case 'lexbass': return chorus ? Math.round(p * 100) + '%' : sec(q.bass);
    case 'lexmid': return chorus ? Math.round(p * 100) + '%' : sec(q.mid);
    case 'lexxover': return chorus ? Math.round(p * 100) + '%' : hz(q.xover);
    case 'lextreble': return chorus ? Math.round(p * 100) + '%' : hz(q.treble);
    case 'lexdepth': return String(q.depth);
    case 'lexdiff': return String(q.diff);
    case 'lexpre': return Math.round(q.pre) + ' ms';
    case 'lexme': return q.me ? 'amt ' + q.me : 'off';
    case 'lexpitch': return String(q.pitch);
    case 'lexmix': return Math.round(p * 100) + '%';
  }
  return '';
}
// plate, spring and convolution readouts
function revText(id, p) {
  const k = { ...state.knobs, [id]: p }, sec = (t) => (t < 10 ? t.toFixed(2) : t.toFixed(1)) + ' s';
  const hz = (f) => f >= 1000 ? (f / 1000).toFixed(f < 10000 ? 1 : 0) + ' kHz' : Math.round(f) + ' Hz', pc = (x) => Math.round(x * 100) + '%';
  const a = plateParams(k), b = springParams(k), c = convParams(k);
  switch (id) {
    case 'platepre': return Math.round(a.pre) + ' ms';
    case 'platedecay': return sec(a.rt);
    case 'platedamp': return hz(a.damp);
    case 'platebw': return hz(a.bw);
    case 'platelo': return hz(a.lo);
    case 'platemod': return pc(a.mod);
    case 'sprdwell': return '×' + b.dwell.toFixed(1);
    case 'sprdecay': return sec(b.rt);
    case 'sprtone': return hz(b.tone);
    case 'sprlo': return hz(b.lo);
    case 'cnvpre': return Math.round(Math.max(c.pre, 1000 * 512 / (ctx ? ctx.sampleRate : 48000))) + ' ms';
    case 'cnvdecay': return c.full ? 'full' : sec(c.rt);
    case 'cnvtone': return hz(c.tone);
    case 'cnvlo': return hz(c.lo);
    case 'cnvwidth': return pc(c.width);
  }
  return pc(p);
}
// One binding for every dial: vertical drag (Shift = fine), arrow and Page keys, Home/End, double-click.
// host is the dial itself, or a container whose dials are found by pick(e) and named by data-k.
// set(k, value, event) and nudge(k, delta, event) receive dial units; min/max enable Home/End.
function bindDial(host, { pick = () => host, get, set, nudge = (k, d, e) => set(k, get(k) + d, e), drag = 160, fine = 600, step = .02, page = .1, min, max, reset, start, focus = false }) {
  let d = null;
  const at = (e) => { const el = pick(e); return el && { el, k: el.dataset.k }; };
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // only a held main button (or a finger) turns a dial
    const t = at(e); if (!t) return;
    t.el.setPointerCapture(e.pointerId); if (focus) t.el.focus();
    d = { k: t.k, y: e.clientY, v: get(t.k), id: e.pointerId, el: t.el }; start?.(t.k, t.el);
  });
  // Dials move only while the button is held (Johnny): a move with no button down ends any drag that missed its release
  // (released outside the window, capture lost), and the wheel / trackpad scroll no longer turns them on hover.
  const end = () => { if (d) d.el.dispatchEvent(new Event('dialend')); d = null; };
  host.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { end(); return; }
    set(d.k, d.v + (d.y - e.clientY) / (e.shiftKey ? fine : drag), e);
  });
  host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end); host.addEventListener('lostpointercapture', end);
  addEventListener('blur', end);
  host.addEventListener('keydown', (e) => {
    const t = at(e); if (!t) return;
    const delta = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: page, PageDown: -page }[e.key];
    if (delta) { e.preventDefault(); nudge(t.k, delta, e); }
    if (min !== undefined && e.key === 'Home') set(t.k, min, e);
    if (max !== undefined && e.key === 'End') set(t.k, max, e);
  });
  if (reset) host.addEventListener('dblclick', (e) => { const t = at(e); if (t) reset(t.k); });
  return { dragging: () => !!d };
}
const knobEls = {};
const REV_IDS = new Set(KNOBS.filter(k => k.fx === 'lex').map(k => k.id)); // everything on the reverb slot
for (const k of KNOBS) {
  if (k.hidden) continue;
  const wrap = document.createElement('div'); wrap.className = k.fx ? 'kn small' : 'kn';
  wrap.innerHTML = `<div class="knob" tabindex="0" role="slider" aria-label="${k.name}" aria-valuemin="0" aria-valuemax="100" id="knob-${k.id}">${knobSVG()}</div>
    <div class="name">${k.name}</div><div class="ref">${k.ref}</div><div class="val"></div>`;
  (k.fx ? document.getElementById('fx-' + k.fx + '-knobs') : panel).appendChild(wrap);
  const el = wrap.querySelector('.knob');
  knobEls[k.id] = { el, wrap, val: wrap.querySelector('.val'), name: wrap.querySelector('.name') };
  bindDial(el, { get: () => state.knobs[k.id], set: (_, v) => setKnob(k.id, v), min: 0, max: 1, reset: () => setKnob(k.id, k.def), start: () => wrap.classList.add('active') });
  el.addEventListener('dialend', () => wrap.classList.remove('active'));
}
function drawKnob(id) {
  if (id === 'dlypp') { drawDlyMode(); return; }
  const p = cseqHeard('k:' + id, state.knobs[id]), k = knobEls[id]; // with a step sequencer running, the value heard
  if (k) {
    knobDraw(k.el, state.knobs[id]); knobHeard(k.el, cseqOn('k:' + id) ? p : -1);
    k.el.setAttribute('aria-valuenow', Math.round(p * 100));
    k.val.textContent = knobText(id, p);
  }
  if (REV_IDS.has(id)) drawLex();
  if (id === 'drvtype') drawDrv();
  if (id === 'flgmode') { drawFlgMode(); if (knobEls.flgman) knobEls.flgman.val.textContent = knobText('flgman', state.knobs.flgman); }
  if (id === 'flgmode' || id === 'drvtype' || id === 'revtype' || id === 'fxorder' || id === 'fxret') drawRoute();
}
function setKnob(id, p) {
  p = Math.min(1, Math.max(0, p)); state.knobs[id] = p;
  preview.setKnob(id, p); drawKnob(id); send({ type: 'knob', name: id, value: cseqHeard('k:' + id, p) }); saveSession();
}


