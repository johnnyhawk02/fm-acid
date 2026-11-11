// Generate's own pattern maker: no stored patterns. Each bar comes from one of 16 step-by-step note styles (after the
// AcidLab generator Johnny brought in: a walking scale degree shaped by the style, a held "repeat note" layer that keeps
// pulling the line back to one pitch, odd octave jumps), then gets 303 slides and is varied bar by bar with the moves below.
// a step is { code, gate, accent, slide }; code 0-59 is the 303's note number (33 = A)
// Density (Johnny: "needs a density knob"): the share of steps Generate and Refill fill with notes, from the dial in the
// sequencer foot; Alter leans its new rests and fills towards it too. Kept across reloads, not in presets
let genDens = Math.min(1, Math.max(0.1, +store.get('genDens', 0.6) || 0.6));
const GEN_SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  'minor pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};
const GEN_STYLES = ['Acid', 'Walk', 'Repeater', 'Syncopated', 'Evolving', 'Accented', 'Octaves', 'Fifths', 'Arpeggio',
  'Alternating', 'Pendulum', 'Rise', 'Fall', 'Dense', 'Sparse', 'Random'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ACID_CONTOUR = [0, 0, 2, 1, 0, 3, 2, 0, 4, 3, 2, 1, 0, 2, 1, 0];
// one bar of len steps. o: root (303 code), scale, style, dens (0-1), rep (repeat-note pull), oct (octave jump chance)
function makeBar(len, o) {
  const { root, scale, style, dens, rep, oct } = o, sl = scale.length, maxD = sl * 2 - 1, r = Math.random;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), step = (n) => (r() < 0.5 ? -1 : 1) * n;
  const deg = (d) => root + Math.floor(d / sl) * 12 + scale[((d % sl) + sl) % sl];
  let prev = Math.floor(sl * 0.35), hold = null;
  const P = [];
  for (let i = 0; i < len; i++) {
    const ph = i % 16, q = i % 4;
    let chance = dens, d = prev;
    // each style moves the scale degree its own way and leans the rhythm on its own steps
    switch (style) {
      case 'Random': d = Math.floor(r() * (maxD + 1)); chance *= 0.92; break;
      case 'Walk': d = clamp(prev + (r() < 0.24 ? 0 : step(Math.ceil(r() * 2))), 0, maxD); break;
      case 'Rise': d = clamp(Math.round(i / Math.max(1, len - 1) * maxD + (r() - 0.5) * 2), 0, maxD); break;
      case 'Fall': d = clamp(maxD - Math.round(i / Math.max(1, len - 1) * maxD + (r() - 0.5) * 2), 0, maxD); break;
      case 'Pendulum': { const p = i % (maxD * 2); d = p <= maxD ? p : maxD * 2 - p; break; }
      case 'Alternating': d = clamp(prev + (i % 2 ? -2 : 2), 0, maxD); chance *= i % 2 ? 0.78 : 1; break;
      case 'Repeater': d = q === 0 || hold === null ? Math.floor(r() * (maxD + 1)) : hold; chance *= 0.88; break;
      case 'Sparse': chance *= 0.62; d = clamp(prev + (r() < 0.65 ? 0 : step(1)), 0, maxD); break;
      case 'Dense': chance = Math.min(0.99, chance * 1.35); d = clamp(prev + (r() < 0.72 ? 0 : step(1)), 0, maxD); break;
      case 'Octaves': d = clamp(prev + (r() < 0.5 ? 0 : step(sl)), 0, maxD); break;
      case 'Fifths': d = [0, 4, 2, 4, 0, 3, 4, 2][ph % 8] % (maxD + 1); break;
      case 'Arpeggio': d = [0, 2, 4, 2, 1, 3, 5, 3][ph % 8] % (maxD + 1); break;
      case 'Syncopated': chance *= [0, 3, 6, 7, 10, 13, 14].includes(ph) ? 1.28 : 0.48; d = clamp(prev + (r() < 0.6 ? 0 : step(2)), 0, maxD); break;
      case 'Accented': chance *= q === 0 ? 1.2 : 0.72; d = clamp(prev + (q === 0 ? 2 : step(1)), 0, maxD); break;
      case 'Evolving': d = clamp(prev + (r() < 0.58 ? 0 : step(Math.ceil(r() * 3))), 0, maxD); chance *= i % 8 < 4 ? 0.78 : 1.12; break;
      default: d = clamp(prev + ACID_CONTOUR[ph] - 1 + (r() < 0.18 ? step(1) : 0), 0, maxD); chance *= ph % 2 ? 0.82 : 1.16; // Acid
    }
    // the repeat-note layer: now and then a new note is held, otherwise steps are pulled back onto it
    if (hold === null || r() < Math.max(0.025, rep * 0.22)) hold = d;
    else if (r() < rep) d = hold;
    let gate = r() < clamp(chance, 0, 0.99);
    if (i === 0 || (style === 'Dense' && i % 2 === 0)) gate = true;
    if (style === 'Sparse' && q !== 0 && i) gate = r() < chance * 0.7;
    let code = deg(d);
    if (r() < oct) code += r() < 0.5 ? -12 : 12;
    while (code > 59) code -= 12;
    while (code < 0) code += 12;
    const accent = gate && (style === 'Accented' ? q === 0 || r() < 0.12 : r() < (q === 0 ? 0.3 : 0.16));
    P.push({ code, gate, accent, slide: false });
    prev = d;
  }
  // slides tie a note into the next played one: most often across an octave jump, into a held note or a step down
  for (let i = 0; i < len - 1; i++) {
    if (!P[i].gate || !P[i + 1].gate) continue;
    const jump = Math.abs(P[i + 1].code - P[i].code);
    if (r() < (jump >= 12 ? 0.35 : jump === 0 ? 0.08 : 0.14)) P[i].slide = true;
  }
  return P;
}
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// moves applied to a made bar, and once to each later bar so the phrase develops
const GEN_MOVES = {
  // grab a few steps and loop them to the end
  loop(P) { const n = P.length, k = rint(2, Math.max(2, Math.min(8, n >> 1))), at = rint(0, n - k), from = rint(at + k, n - 1);
    const seg = P.slice(at, at + k); for (let i = from; i < n; i++) P[i] = { ...seg[(i - from) % k] }; return `looped steps ${at + 1}–${at + k} from step ${from + 1} to the end`; },
  reverse(P) { if (Math.random() < 0.5) { P.reverse(); return 'reversed'; }
    const h = P.length >> 1, back = P.slice(h).reverse(); P.splice(h, back.length, ...back); return 'reversed the second half'; },
  // a step plays twice in a row, pushing the rest along (the end drops off)
  dup(P) { const c = rint(1, Math.max(1, P.length >> 3)); for (let j = 0; j < c; j++) { const i = rint(0, P.length - 2); P.splice(i, 0, { ...P[i] }); P.pop(); } return `doubled ${c} step${c > 1 ? 's' : ''}`; },
  // AcidLab's Mutate, gentler: a few steps flip on or off, move a note or two, or swap accents; the shape stays
  mutate(P) { let c = 0; for (const st of P) {
      if (Math.random() < 0.12) { st.gate = !st.gate; if (!st.gate) st.accent = st.slide = false; c++; }
      if (st.gate && Math.random() < 0.15) { const n = st.code + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2); if (n >= 0 && n <= 59) st.code = n; c++; }
      if (st.gate && Math.random() < 0.1) { st.accent = !st.accent; c++; } }
    return `mutated ${c} step${c === 1 ? '' : 's'}`; },
  shuffle(P) { const n = P.length, b = n >= 8 && Math.random() < 0.5 ? 4 : 1, blocks = [];
    for (let i = 0; i < n; i += b) blocks.push(P.slice(i, i + b));
    const sw = rint(1, Math.max(1, blocks.length >> 2));
    for (let j = 0; j < sw; j++) { const x = rint(0, blocks.length - 1), y = rint(0, blocks.length - 1); [blocks[x], blocks[y]] = [blocks[y], blocks[x]]; }
    P.splice(0, n, ...blocks.flat()); return b > 1 ? `swapped ${sw} beat${sw > 1 ? 's' : ''}` : `swapped ${sw} step${sw > 1 ? 's' : ''}`; },
};
// density: null keeps the source's own; otherwise a fraction of steps that play. Sources near it are preferred, then notes are added or removed to hit it
function generatePattern(len, dens = null) {
  const style = pick(GEN_STYLES), sn = pick(Object.keys(GEN_SCALES)), root = rint(21, 33);
  const o = { root, scale: GEN_SCALES[sn], style, dens: dens != null ? Math.max(0.2, Math.min(0.95, dens * 1.1)) : 0.5 + Math.random() * 0.35,
    rep: Math.random() * 0.5, oct: 0.04 + Math.random() * 0.16 };
  const name = `${style} ${NOTE_NAMES[root % 12]} ${sn}`;
  // build one bar, move it, then later bars are the first one with one more move each
  const barLen = Math.min(len, 16);
  const P = makeBar(barLen, o);
  const did = Object.keys(GEN_MOVES).sort(() => Math.random() - 0.5).slice(0, rint(0, 2)).map(m => GEN_MOVES[m](P));
  const out = [...P];
  while (out.length < len) {
    const seg = P.map(st => ({ ...st })), mv = Object.keys(GEN_MOVES); GEN_MOVES[mv[rint(0, mv.length - 1)]](seg);
    out.push(...seg.slice(0, len - out.length));
  }
  if (len > barLen) did.push(`bars 2–${Math.ceil(len / 16)} varied`);
  if (dens != null) {
    const want = Math.max(1, Math.round(dens * len)), pitches = out.filter(st => st.gate).map(st => st.code);
    const idx = (g) => [...out.keys()].filter(i => out[i].gate === g).sort(() => Math.random() - 0.5);
    let on = out.filter(st => st.gate).length;
    // add notes on off-beats last, remove them from off-beats first, so the downbeats survive
    const beat = (i) => (i % 4 === 0 ? 0 : i % 2 === 0 ? 1 : 2);
    if (on < want) for (const i of idx(false).sort((a, b) => beat(a) - beat(b))) { if (on >= want) break; out[i].gate = true; out[i].code = pitches.length ? pitches[rint(0, pitches.length - 1)] : out[i].code; out[i].slide = false; on++; }
    if (on > want) for (const i of idx(true).sort((a, b) => beat(b) - beat(a))) { if (on <= want) break; if (i === 0) continue; out[i].gate = false; out[i].accent = false; out[i].slide = false; on--; }
  }
  if (!out.some(st => st.gate)) out[0].gate = true;
  return { pattern: out, src: name, did };
}

