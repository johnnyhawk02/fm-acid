// ---------- pattern undo, install, join (the Functions menu is gone: Undo and Join live in Tools, Install in Options › About) ----------
const sqMsg = document.getElementById('sq-msg');
let sqMsgT = 0;
function sqSay(t) { sqMsg.textContent = t; clearTimeout(sqMsgT); sqMsgT = setTimeout(() => { sqMsg.textContent = ''; }, 5000); }
const undoStack = [];
function pushUndo() { undoStack.push({ k: slotKey(sel.g, sel.n), pattern: state.pattern.map(st => ({ ...st })) }); if (undoStack.length > 30) undoStack.shift(); document.getElementById('p-undo').disabled = false; }
// ---------- install as an app ----------
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
addEventListener('appinstalled', () => { installEvt = null; document.getElementById('opt-install').hidden = true; installSay('Installed. Open 303 from your home screen or app list.'); });
if (standalone()) document.getElementById('opt-install').hidden = true;
// install messages show beside the button (Options covers the status line) and in the status line
function installSay(t) { document.getElementById('opt-install-msg').textContent = t; sqSay(t); }
document.getElementById('opt-install').onclick = () => FUNCTIONS.install();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
// spread of each part between real units: 0 means it does not vary (digital settings in the 224)
function tolerance(k) {
  const d = COMPONENTS[k];
  if (d.fixed || d.block === '224') return 0;
  if (d.block === 'CV') return 0.005;          // matched 1% parts in the pitch DAC; more than this puts the scale out of tune
  if (k === 'F_TUNE' || k === 'CV_TUNE') return 0.003; // set by the tuning trimmers at the factory, so only a few cents out
  if (/^VR/.test(k)) return 0.2;               // pots are ±20%
  if (d.unit === 'Ω') return 0.05;             // carbon film, ±5%
  if (d.unit === 'F') return d.v >= 1e-6 ? 0.2 : 0.1; // electrolytics ±20%, film and ceramic ±10%
  if (/^RAT_(GBW|SR)$/.test(k)) return 0.2;    // op-amp spec spread
  return 0.05;                                  // voltages, gains, trims: transistor and supply spread
}
const FUNCTIONS = {
  async install() {
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r?.outcome !== 'accepted') installSay('Install cancelled.'); installEvt = null; return; }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) installSay('On iPhone or iPad: tap Share, then Add to Home Screen.');
    else if (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)) installSay('In Safari on a Mac: File › Add to Dock.');
    else installSay('Use your browser menu: Install 303 Circuit Model, or Add to Home screen.');
  },
  // a variation, not a new pattern: about a quarter of the steps change. It borrows Generate's AcidLab habits: new notes
  // walk a scale step or two in the pattern's own key or snap back to its most used note (the repeat note), filled
  // rests take the repeat note, rests land on off-beats and fills on the beat, and now and then every beat is made to play
  alter() {
    pushUndo();
    const P = state.pattern, n = P.length, r = Math.random, used = P.filter(st => st.gate).map(st => st.code);
    const pitches = [...new Set(used)].sort((a, b) => a - b);
    if (!pitches.length) pitches.push(24);
    const count = {}; for (const c of used) count[c] = (count[c] || 0) + 1;
    const hold = +Object.keys(count).sort((a, b) => count[b] - count[a])[0] || pitches[0];
    // the key: the repeat note as root, with whichever of Generate's scales holds most of the notes the pattern uses
    const pcs = used.map(c => (((c - hold) % 12) + 12) % 12);
    const scale = Object.values(GEN_SCALES).map(sc => [sc, pcs.filter(pc => sc.includes(pc)).length]).sort((a, b) => b[1] - a[1])[0][0];
    // a neighbouring note one or two scale steps up or down, so the line walks but stays in its key
    const walk = (c) => { const inKey = []; for (let k = 0; k <= 59; k++) if (scale.includes((((k - hold) % 12) + 12) % 12)) inKey.push(k);
      let i = inKey.findIndex(k => k >= c); if (i < 0) i = inKey.length - 1;
      return inKey[Math.max(0, Math.min(inKey.length - 1, i + (r() < 0.5 ? -1 : 1) * (r() < 0.7 ? 1 : 2)))]; };
    const idx = [...Array(n).keys()].sort(() => r() - 0.5).slice(0, Math.max(1, Math.round(n / 4)));
    const done = { note: 0, octave: 0, accent: 0, slide: 0, rest: 0, gate: 0, beat: 0 };
    for (const i of idx) {
      const st = P[i], x = r(), beat = i % 4 === 0, off = i % 2 === 1;
      if (x < 0.4) {
        const was = st.code; st.code = st.code !== hold && r() < 0.35 ? hold : walk(st.code);
        if (st.code === was) st.code = walk(was);
        st.gate = true; done.note++;
      }
      else if (x < 0.52) { const up = st.code + 12 <= 59 && (st.code - 12 < 0 || r() < 0.5); st.code += up ? 12 : -12; done.octave++; }
      else if (x < 0.66) { st.accent = !st.accent; done.accent++; }
      else if (x < 0.8) { st.slide = !st.slide; done.slide++; }
      // rests and fills lean towards the density dial: over it, notes become rests; under it, rests get filled
      else if (i > 0 && (P.filter(s => s.gate).length / n > genDens + 0.05 ? st.gate && !beat : P.filter(s => s.gate).length / n < genDens - 0.05 ? !st.gate : (st.gate ? !beat && (off || r() < 0.4) : !off || r() < 0.5))) {
        st.gate = !st.gate;
        if (st.gate) { st.code = hold; done.gate++; } else { st.accent = st.slide = false; done.rest++; }
      }
      else { st.accent = !st.accent; done.accent++; }
    }
    // AcidLab's Mutate sometimes puts a note on every beat: here one press in eight, with the repeat note
    if (n >= 8 && r() < 0.125) for (let i = 0; i < n; i += 4) if (!P[i].gate) { P[i].gate = true; P[i].code = hold; done.beat++; }
    renderSeq(); pushPattern();
    const words = { note: ['note', 'notes'], octave: ['octave jump', 'octave jumps'], accent: ['accent', 'accents'], slide: ['slide', 'slides'], rest: ['new rest', 'new rests'], gate: ['rest filled', 'rests filled'], beat: ['beat filled', 'beats filled'] };
    sqSay('Altered ' + Object.entries(done).filter(([, v]) => v).map(([k, v]) => `${v} ${words[k][v > 1 ? 1 : 0]}`).join(', ') + '. Undo puts it back.');
  },
  // New machine: like building a real unit, each part lands somewhere inside its tolerance (triangular, so most land near the middle).
  // Messed up: circuit-bent; every part swings a quarter of its knob travel either way and about a third swing up to 60%.
  // The pitch DAC and tuning stay within tolerance either way, so it still plays in tune. Only sets that still make a sound are kept.
  parts(wild = false) {
    partsUndo.push({ ...state.parts }); if (partsUndo.length > 30) partsUndo.shift(); syncPartsUndo();
    const keys = Object.keys(COMPONENTS).filter(k => !COMPONENTS[k].fixed && tolerance(k));
    const pitch = (k) => COMPONENTS[k].block === 'CV' || k === 'F_TUNE' || k === 'CV_TUNE';
    const nudge = (k) => {
      const d = COMPONENTS[k], [lo, hi] = partRange(k), tri = Math.random() + Math.random() - 1;
      if (!wild || pitch(k)) return +Math.min(hi, Math.max(lo, d.v * (1 + tolerance(k) * tri))).toPrecision(4);
      const t = toSlider(k, d.v) / SL + (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 0.6 : 0.25);
      return +fromSlider(k, Math.min(1, Math.max(0, t)) * SL).toPrecision(4);
    };
    const pick = () => Object.fromEntries(keys.map(k => [k, nudge(k)]));
    let set = null;
    for (let tries = 0; tries < (wild ? 24 : 8) && !set; tries++) {
      const cand = pick(), v = new TB303Voice(22050);
      for (const k in cand) v.setComponent(k, cand[k]);
      // the volume knob is left out of the test (Johnny: New unit did nothing with the volume turned down): it only scales the level
      for (const kn of KNOBS) v.setKnob(kn.id, kn.id === 'volume' ? 0.85 : state.knobs[kn.id]);
      v.waveform = state.wave;
      const buf = new Float32Array(11025); let e = 0, ok = true;
      for (let n = 0; n < 4; n++) { v.noteOn(24 + 7 * (n & 1), n === 2, false); v.process(buf, n * 2756, n * 2756 + 1500); v.noteOff(); v.process(buf, n * 2756 + 1500, n * 2756 + 2756); }
      for (const x of buf) { if (!isFinite(x)) ok = false; e += x * x; }
      if (ok && Math.sqrt(e / buf.length) > 0.015) set = cand;
    }
    if (!set) { partsUndo.pop(); syncPartsUndo(); sqSay('Could not find a random set that still sounds. Try again.'); return; }
    applySound({ ...soundSnap(), parts: set });
    sqSay(wild ? `Messed up: ${keys.length} parts bent well outside spec (tuning left alone). Undo puts them back.`
      : `Built a new machine: ${keys.length} parts somewhere inside their real tolerances. Options › Circuit shows them, and Undo puts them back.`);
  },
  undo() {
    const u = undoStack.pop(); if (!u) return;
    if (u.k !== slotKey(sel.g, sel.n)) loadSlot(u.k[0], +u.k.slice(1) - 1);
    state.pattern = u.pattern; tail = []; renderSeq(); pushPattern();
    document.getElementById('p-undo').disabled = !undoStack.length; sqSay(`Undone on ${u.k}.`);
  },
  // join every chained pattern into one and put it on the Copy/Paste clipboard (and the system clipboard as JSON)
  join() {
    storeSlot();
    const keys = chain.length >= 2 ? chain : [slotKey(sel.g, sel.n)];
    const all = keys.flatMap(k => slotPattern(k)), cut = all.length > 64;
    clip = { shuffle: state.shuffle, gate: state.gate, pattern: all.slice(0, 64) };
    store.set('clip', clip); renderBank();
    try { navigator.clipboard?.writeText(JSON.stringify({ app: 'tb303-circuit-model', pattern: clip.pattern })).catch(() => {}); } catch {}
    sqSay(chain.length < 2 ? `No chain, copied ${keys[0]} (${all.length} steps). Paste it into a slot.`
      : `Joined ${keys.join(' › ')}: ${Math.min(64, all.length)} steps copied${cut ? `, the last ${all.length - 64} cut off at the 64-step limit` : ''}. Paste it into a slot.`);
  },
};
document.getElementById('chain-clear').onclick = () => { chain = []; store.set('chain', chain); playingSlot = ''; sendPattern(); renderChain(); };
// the slot that was selected last holds the current pattern; seed it the first time
if (!banks[slotKey(sel.g, sel.n)]) storeSlot();
fillSlots(false);
document.getElementById('p-refill').onclick = () => { fillSlots(true); sendPattern(); renderBank(); };

