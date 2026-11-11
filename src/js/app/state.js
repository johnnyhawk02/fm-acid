const KNOBS = [
  { id: 'tuning',    name: 'Tuning',    ref: 'VR2 50K(B)', def: 0.5 },
  { id: 'cutoff',    name: 'Cutoff',    ref: 'VR3',        def: 0.3 },
  { id: 'resonance', name: 'Reso',      ref: 'VR4 50K(B)', def: 0.82 },
  { id: 'envmod',    name: 'Env mod',   ref: 'VR5 50K(A)', def: 0.62 },
  { id: 'decay',     name: 'Decay',     ref: 'VR6 1M(A)',  def: 0.3 },
  { id: 'accent',    name: 'Accent',    ref: 'VR7 50K(B)', def: 0.75 },
  { id: 'volume',    name: 'Volume',    ref: 'VR8 50K(A)', def: 0.85 },
  // the drive slot (fx.rat switches it on): drvtype picks the pedal, drv says whose dial it is
  { id: 'drvtype',   name: 'Pedal',     ref: 'Rodent/Dist One/Green 808', def: 0, fx: 'rat', hidden: true },
  { id: 'dist',      name: 'Distortion',ref: '100k(A)',    def: 0.5,  fx: 'rat', drv: 'rat' },
  { id: 'filter',    name: 'Filter',    ref: '100k(B)',    def: 0.4,  fx: 'rat', drv: 'rat' },
  { id: 'ratvol',    name: 'Volume',    ref: '100k(A)',    def: 0.5,  fx: 'rat', drv: 'rat' },
  { id: 'dsdist',    name: 'Dist',      ref: 'VR1 100k(B)', def: 0.5, fx: 'rat', drv: 'ds' },
  { id: 'dstone',    name: 'Tone',      ref: 'VR3 20k(B)', def: 0.5,  fx: 'rat', drv: 'ds' },
  { id: 'dslevel',   name: 'Level',     ref: 'VR2 100k(A)', def: 0.5, fx: 'rat', drv: 'ds' },
  { id: 'tsdrive',   name: 'Drive',     ref: '500k(A)',    def: 0.5,  fx: 'rat', drv: 'ts' },
  { id: 'tstone',    name: 'Tone',      ref: '20k(B)',     def: 0.5,  fx: 'rat', drv: 'ts' },
  { id: 'tslevel',   name: 'Level',     ref: '100k(A)',    def: 0.5,  fx: 'rat', drv: 'ts' },
  // Buchla 259 timbre folder, ahead of the drive slot
  { id: 'fldtimbre', name: 'Timbre',    ref: '0.5–10 V',    def: 0.5,  fx: 'fold' },
  { id: 'fldsym',    name: 'Symmetry',  ref: '±2 V',       def: 0.5,  fx: 'fold' },
  { id: 'fldlevel',  name: 'Level',     ref: 'output',     def: 0.5,  fx: 'fold' },
  { id: 'lexprog',   name: 'Program',   ref: 'P1–P9',      def: 0.125, fx: 'lex', hidden: true },
  { id: 'lexbass',   name: 'Bass',      ref: '0.6–70 s',   def: 0.3,  fx: 'lex' },
  { id: 'lexmid',    name: 'Mid',       ref: '0.6–70 s',   def: 0.27, fx: 'lex' },
  { id: 'lexxover',  name: 'Crossover', ref: '100 Hz–10.9k', def: 0.443, fx: 'lex' },
  { id: 'lextreble', name: 'Treble',    ref: '100 Hz–10.9k', def: 0.834, fx: 'lex' },
  { id: 'lexdepth',  name: 'Depth',     ref: '0–71',       def: 0.5,  fx: 'lex' },
  { id: 'lexdiff',   name: 'Diffusion', ref: '0–63',       def: 0.55, fx: 'lex' },
  { id: 'lexpre',    name: 'Predelay',  ref: 'per program', def: 0.2, fx: 'lex' },
  { id: 'lexme',     name: 'Mode enh',  ref: 'off, 16–1',  def: 0.5,  fx: 'lex' },
  { id: 'lexpitch',  name: 'Pitch',     ref: '1–16',       def: 0.2,  fx: 'lex' },
  { id: 'lexmix',    name: 'Return',    ref: 'wet level',  def: 0.5,  fx: 'lex' },
  // the reverb slot's other units (rev = which one; revtype picks the unit, the *prog knobs are the program buttons)
  { id: 'revtype',   name: 'Reverb',    ref: '224/plate/spring/conv', def: 0, fx: 'lex', hidden: true },
  { id: 'plateprog', name: 'Size',      ref: 'tiny–huge',  def: 0.5,  fx: 'lex', rev: 'plate', hidden: true },
  { id: 'platepre',  name: 'Predelay',  ref: '0–250 ms',   def: 0.2,  fx: 'lex', rev: 'plate' },
  { id: 'platedecay',name: 'Decay',     ref: '0.3–20 s',   def: 0.45, fx: 'lex', rev: 'plate' },
  { id: 'platedamp', name: 'Damping',   ref: '1k–20 kHz',  def: 0.6,  fx: 'lex', rev: 'plate' },
  { id: 'platebw',   name: 'Bandwidth', ref: '1k–20 kHz',  def: 0.75, fx: 'lex', rev: 'plate' },
  { id: 'platelo',   name: 'Low cut',   ref: '20 Hz–1k',   def: 0.35, fx: 'lex', rev: 'plate' },
  { id: 'platediff', name: 'Diffusion', ref: '0–100%',     def: 0.88, fx: 'lex', rev: 'plate' },
  { id: 'platemod',  name: 'Mod',       ref: '0–200%',     def: 0.5,  fx: 'lex', rev: 'plate' },
  { id: 'platemix',  name: 'Return',    ref: 'wet level',  def: 0.5,  fx: 'lex', rev: 'plate' },
  { id: 'sprprog',   name: 'Tank',      ref: '1–3 springs', def: 2 / 3, fx: 'lex', rev: 'spring', hidden: true },
  { id: 'sprdwell',  name: 'Dwell',     ref: 'drive in',   def: 0.4,  fx: 'lex', rev: 'spring' },
  { id: 'sprdecay',  name: 'Decay',     ref: '0.4–6 s',    def: 0.5,  fx: 'lex', rev: 'spring' },
  { id: 'sprtension',name: 'Tension',   ref: 'chirp',      def: 0.5,  fx: 'lex', rev: 'spring' },
  { id: 'sprtone',   name: 'Tone',      ref: '1.5–6 kHz',  def: 0.5,  fx: 'lex', rev: 'spring' },
  { id: 'sprlo',     name: 'Low cut',   ref: '50 Hz–1k',   def: 0.4,  fx: 'lex', rev: 'spring' },
  { id: 'sprmix',    name: 'Return',    ref: 'wet level',  def: 0.5,  fx: 'lex', rev: 'spring' },
  { id: 'cnvprog',   name: 'IR',        ref: 'space',      def: 0,    fx: 'lex', rev: 'conv', hidden: true },
  { id: 'cnvpre',    name: 'Predelay',  ref: '11–250 ms',  def: 0.2,  fx: 'lex', rev: 'conv' },
  { id: 'cnvdecay',  name: 'Decay',     ref: 'length / decay', def: 1,  fx: 'lex', rev: 'conv' },
  { id: 'cnvtone',   name: 'Tone',      ref: '1k–20 kHz',  def: 0.7,  fx: 'lex', rev: 'conv' },
  { id: 'cnvlo',     name: 'Low cut',   ref: '20 Hz–1k',   def: 0.3,  fx: 'lex', rev: 'conv' },
  { id: 'cnvwidth',  name: 'Width',     ref: '0–150%',     def: 2 / 3, fx: 'lex', rev: 'conv' },
  { id: 'cnvmix',    name: 'Return',    ref: 'wet level',  def: 0.5,  fx: 'lex', rev: 'conv' },
  { id: 'dlytime',   name: 'Time',      ref: '1/32–1/2',   def: 0.7,  fx: 'dly' },
  { id: 'dlyfb',     name: 'Feedback',  ref: '0–95%',      def: 0.35, fx: 'dly' },
  { id: 'dlylo',     name: 'Low cut',   ref: '20 Hz–1k',   def: 0.3,  fx: 'dly' },
  { id: 'dlyhi',     name: 'High cut',  ref: '1k–20 kHz',  def: 0.55, fx: 'dly' },
  { id: 'dlymix',    name: 'Return',    ref: 'wet level',  def: 0.35, fx: 'dly' },
  { id: 'dlypp',     name: 'Ping-pong', ref: 'mono/ping-pong', def: 1, fx: 'dly', hidden: true },
  { id: 'cmpamt',    name: 'Amount',    ref: 'depth + key', def: 0.3, fx: 'cmp' },
  { id: 'cmprel',    name: 'Release',   ref: '0–1 s',      def: 0.5, fx: 'cmp' }, // 250 ms
  // Flanger after the Boss BF-2 (fx.flg switches it on), on the synth ahead of the returns; flgmode: flanger or chorus
  { id: 'flgman',    name: 'Manual',    ref: '1–12.8 ms',  def: 0.5,  fx: 'flg' },
  { id: 'flgdep',    name: 'Depth',     ref: 'sweep',      def: 0.5,  fx: 'flg' },
  { id: 'flgrate',   name: 'Rate',      ref: '0.1–10 Hz',  def: 0.3,  fx: 'flg' },
  { id: 'flgres',    name: 'Res',       ref: 'feedback',   def: 0.5,  fx: 'flg' },
  { id: 'flgmode',   name: 'Mode',      ref: 'flanger/chorus', def: 0, fx: 'flg', hidden: true },
  // FX routing (the block diagram on the FX page): folder/drive order, and how the delay and reverb returns connect
  { id: 'fxorder',   name: 'Order',     ref: 'folder→drive / drive→folder', def: 0, fx: 'route', hidden: true },
  { id: 'fxret',     name: 'Returns',   ref: 'parallel / delay→reverb / reverb→delay', def: 0, fx: 'route', hidden: true },
];
const NOTE = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
// original example line, A minor-ish, codes around A = 33
const EXAMPLE = [
  [21,1,0,1],[21,0,0,1],[33,0,1,1],[31,0,0,1],[21,1,0,1],[0,0,0,0],[24,0,1,1],[26,0,0,1],
  [21,0,0,1],[33,1,0,1],[28,0,1,1],[24,0,0,1],[21,1,1,1],[19,0,0,1],[0,0,0,0],[36,1,0,1],
].map(([code, accent, slide, gate]) => ({ code: code || 21, accent: !!accent, slide: !!slide, gate: !!gate }));

const store = {
  get(k, d) { try { const v = tbStore.getItem('tb303.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { tbStore.setItem('tb303.' + k, JSON.stringify(v)); } catch {} },
};
// v30-v31 briefly used the cleaner schematic's part names (parts version 3); sounds saved then are converted back once
function unmigrateParts(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
  const q = { ...p }, mv = (a, b) => { delete q[a]; if (a in p) q[b] = p[a]; };
  delete q.R63; delete q.R72; if ('R72' in p) q.R63 = p.R72; if ('R63' in p) q.R72 = p.R63;
  mv('R46', 'R_ACC'); mv('C13', 'C_ACC'); mv('R35', 'R_SQB'); mv('R36', 'R_SQC'); delete q.TM3; delete q.V_CUT0;
  if (typeof p.V_CUT === 'number') q.V_CUT = +(p.V_CUT * 3.3 / 10).toPrecision(3);
  if (typeof p.I_REF === 'number') q.I_REF = +(p.I_REF * 3.1 / 1.82).toPrecision(3);
  return q;
}
function unmigrateTree(o) {
  if (Array.isArray(o)) o.forEach(unmigrateTree);
  else if (o && typeof o === 'object') for (const k in o) { if (k === 'parts') o[k] = unmigrateParts(o[k]); else unmigrateTree(o[k]); }
  return o;
}
if (store.get('partsVersion', 0) === 3) {
  try {
    for (let i = 0; i < tbStore.length; i++) {
      const key = tbStore.key(i); if (!key.startsWith('tb303.')) continue;
      const raw = tbStore.getItem(key); if (!raw || !raw.includes('"parts"')) continue;
      try { tbStore.setItem(key, JSON.stringify(unmigrateTree(JSON.parse(raw)))); } catch {}
    }
  } catch {}
  store.set('partsVersion', 2);
}
const state = {
  knobs: Object.fromEntries(KNOBS.map(k => [k.id, k.def])),
  wave: 'saw', bpm: 128, fx: { rat: false, lex: false, dly: false, fold: false, flg: false }, shuffle: 0, gate: 0.5,
  pattern: store.get('pattern', null) || EXAMPLE.map(s => ({ ...s })),
  parts: {},
  tune: new Array(12).fill(0), // cents, C..B, every octave (tuning.js)
  seqs: {}, // per-control step sequencers (ctlseq.js), by control: 'k:cutoff' for a knob, 'p:KT' for a part dial
};
// a control's step sequencer: on, 2-64 steps, slew 0-100%, speed (each step 1, 2 ... 128 sixteenths), depth 0-100% of the
// control's range, and 64 steps, each an offset -1..1 of the depth (in twentieths) from the control's own setting
const CSEQ_MAX = 64, CSEQ_SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128];
const cseqOff = (x) => Math.round(Math.max(-1, Math.min(1, +x || 0)) * 20) / 20;
const newCtlSeq = () => ({ on: true, len: 16, slew: 0, step: 1, depth: 50, vals: new Array(CSEQ_MAX).fill(0) });
function cleanSeqs(x) {
  const out = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [key, q] of Object.entries(x)) {
    const m = /^([kp]):(.+)$/.exec(key); if (!m || !q || typeof q !== 'object') continue;
    if (m[1] === 'k' ? !KNOBS.some(k => k.id === m[2] && !k.hidden) : !(m[2] in COMPONENTS) || COMPONENTS[m[2]].fixed) continue;
    const vals = Array.isArray(q.vals) ? q.vals : [];
    out[key] = { on: !!q.on, len: Math.max(2, Math.min(CSEQ_MAX, (q.len | 0) || 16)), slew: Math.max(0, Math.min(100, Math.round((+q.slew || 0) / 5) * 5)),
      step: CSEQ_SPEEDS.includes(q.step) ? q.step : 1, depth: typeof q.depth === 'number' ? Math.max(0, Math.min(100, Math.round(q.depth / 5) * 5)) : 50,
      vals: Array.from({ length: CSEQ_MAX }, (_, i) => cseqOff(vals[i])) };
  }
  return out;
}
for (const k in COMPONENTS) state.parts[k] = COMPONENTS[k].v;
// a part differs from stock (works for parts whose stock value is 0)
function partChanged(k, v = state.parts[k]) { const d = COMPONENTS[k].v; return Math.abs(v - d) > (d ? 1e-6 * Math.abs(d) : 1e-9); }
function cleanSettings(x) {
  const out = { knobs: {}, parts: {} };
  if (!x || typeof x !== 'object') return out;
  // sounds saved before the two-dial Compactor (no Amount) load with the house setting: 40%, 20 ms release
  if (x.knobs && typeof x.knobs === 'object' && !('cmpamt' in x.knobs)) x = { ...x, knobs: { ...x.knobs, cmpamt: 0.3, cmprel: 0.5 } };
  for (const k of KNOBS) { const v = x.knobs?.[k.id]; if (typeof v === 'number' && v >= 0 && v <= 1) out.knobs[k.id] = v; }
  for (const k in COMPONENTS) { const v = x.parts?.[k]; if (typeof v === 'number' && isFinite(v) && v >= 0 && !COMPONENTS[k].fixed) out.parts[k] = k === 'NOISE' ? Math.min(v, COMPONENTS.NOISE.range[1]) : v; }
  if (x.wave === 'saw' || x.wave === 'square') out.wave = x.wave;
  if (x.fx && typeof x.fx === 'object') out.fx = { rat: !!x.fx.rat, lex: !!x.fx.lex, dly: !!x.fx.dly, fold: !!x.fx.fold, flg: !!x.fx.flg };
  if (typeof x.bpm === 'number' && x.bpm >= 60 && x.bpm <= 200) out.bpm = Math.round(x.bpm);
  if (Array.isArray(x.pattern) && x.pattern.length >= 1 && x.pattern.length <= 64) out.pattern = x.pattern.map(st => ({
    code: Math.min(59, Math.max(0, (st && st.code) | 0)), gate: !!st?.gate, accent: !!st?.accent, slide: !!st?.slide }));
  if (typeof x.gate === 'number' && x.gate >= 0.1 && x.gate <= 0.95) out.gate = x.gate;
  if (x.seqs) { const q = cleanSeqs(x.seqs); if (Object.keys(q).length) out.seqs = q; }
  if (Array.isArray(x.tune) && x.tune.length === 12) out.tune = x.tune.map(c => typeof c === 'number' && isFinite(c) ? Math.round(Math.min(100, Math.max(-100, c)) * 10) / 10 : 0);
  return out;
}
function snapshot() {
  const parts = {};
  for (const k in COMPONENTS) if (!COMPONENTS[k].fixed && partChanged(k)) parts[k] = state.parts[k];
  return { knobs: { ...state.knobs }, parts, ...(state.tune.some(c => c) && { tune: [...state.tune] }), ...(Object.keys(state.seqs).length && { seqs: JSON.parse(JSON.stringify(state.seqs)) }), wave: state.wave, fx: { ...state.fx }, bpm: state.bpm, shuffle: state.shuffle, gate: state.gate, pattern: state.pattern.map(st => ({ ...st })) };
}
{ // restore last session
  const sess = cleanSettings(store.get('session', null));
  Object.assign(state.knobs, sess.knobs); Object.assign(state.parts, sess.parts);
  if (sess.fx) state.fx = { rat: !!sess.fx.rat, lex: !!sess.fx.lex, dly: !!sess.fx.dly, fold: !!sess.fx.fold, flg: !!sess.fx.flg };
  if (sess.tune) state.tune = sess.tune;
  if (sess.seqs) state.seqs = sess.seqs;
  if (sess.wave) state.wave = sess.wave; if (sess.bpm) state.bpm = sess.bpm; if (sess.pattern) state.pattern = sess.pattern;
  if (sess.shuffle != null) state.shuffle = sess.shuffle; if (sess.gate != null) state.gate = sess.gate;
}
let saveTimer = 0;
function saveSession() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('session', snapshot()), 300); }
const preview = new TB303Voice(44100); // main-thread copy for derived readouts

let ctx = null, node = null, analyser = null, fallback = null;
// the deploy stamps the version; a local build shows 'dev'
{ const v = document.getElementById('ver'); if (v.textContent.startsWith('__')) { v.textContent = 'dev'; v.title = 'Local build'; } }
{ const a = document.querySelector('.about-ver'); if (a) a.textContent = document.getElementById('ver').textContent; } // About shows the version too
const send = (m) => { if (tbPlugin) tbPlugin.send(m); else if (node) node.port.postMessage(m); else if (fallback) fallback.msg(m); };
// de-click is a playback preference, kept apart from sounds and projects; its switch went with the Options Monitor tab, so a stored setting still holds and the default is on, 1.5 ms
const declick = Object.assign({ on: true, ms: 1.5 }, store.get('declick', {}));
function sendDeclick() { send({ type: 'declick', on: declick.on, ms: declick.ms }); }

