// ---------- new sounds: Randomise, Alter and the level they are set to ----------
// After fm/dm's randomisers (src/ui/randomise.js: its kit and alter randomisers and their groups tone, shape, noise,
// filter, mod) and its auto-level (src/ui/autolevel.js), for this one voice, with ranges that stay musical for a bass:
// carriers at ratio 1 or 2, modulators mostly on whole or half ratios, no fixed operators, no hi-hat territory.
// Plain functions on a sound (an object of FM parameters in real units), with no page in them, so
// tools/make-presets.js can use them in Node.
if (typeof module !== 'undefined' && module.exports && typeof FmVoice === 'undefined') Object.assign(globalThis, require('../../synth.js'));

// how likely Randomise is to touch each group (fm/dm's kit randomiser)
const SND_CHANCE = { tone: 1, shape: 1, noise: 1, filter: 0.7, mod: 0.3 };
const SND_MOD_RATIOS = [1, 1, 1, 2, 2, 2, 3, 3, 0.5, 4, 1.5, 2.5, 3.5, 5, 7];
function soundRandom(cur, rr = Math.random) {
  const s = { ...cur }, lin = (a, b) => a + rr() * (b - a), ex = (a, b) => a * Math.pow(b / a, rr()), pick = (l) => l[Math.floor(rr() * l.length)], ch = (g) => rr() < SND_CHANCE[g];
  if (ch('tone')) {
    s.algo = pick([0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7]);
    const car = FM_ALG_CAR[s.algo], mods = FM_ALG_MOD[s.algo];
    const used = (j) => mods.some((m) => (m >> j) & 1); // a modulator the algorithm actually routes somewhere
    let nmod = 0;
    for (let o = 0; o < 4; o++) {
      const O = 'ABCD'[o];
      s['fx' + O] = 0;
      if ((car >> o) & 1) { // a carrier: the note itself, or its octave
        s['r' + O] = o === 0 ? (rr() < 0.85 ? 1 : 2) : pick([1, 1, 2, 2, 0.5]);
        s['l' + O] = o === 0 ? 1 : lin(0.4, 1);
        s['a' + O] = 0; s['d' + O] = ex(1500, 4000);
      } else {
        s['r' + O] = pick(SND_MOD_RATIOS);
        s['l' + O] = used(o) && (nmod === 0 || rr() < 0.75) ? lin(0.35, 1) : 0;
        if (s['l' + O] > 0) nmod++;
        s['a' + O] = rr() < 0.2 ? lin(2, 40) : 0; s['d' + O] = ex(40, 1500);
      }
    }
    s.fmLvl = lin(0.3, 0.8); s.fmDecay = 1;
    s.fb = rr() < 0.5 ? 0 : lin(-0.6, 0.7);
    s.fmEnd = rr() < 0.6 ? lin(0, 0.15) : lin(0.15, 0.4);
    s.phase = rr() < 0.3 ? 1 : 0;
    s.drift = rr() < 0.3 ? lin(-0.15, 0.15) : 0;
    s.fmNoise = rr() < 0.2 ? lin(0.05, 0.3) : 0;
    s.hum = lin(0, 0.2);
  }
  if (ch('shape')) {
    s.pAmt = rr() < 0.7 ? 0 : lin(1, 12); s.pDec = ex(10, 80);
    s.clk = rr() < 0.6 ? 0 : lin(0.05, 0.4); s.clkType = pick([0, 1, 2]); s.clkDec = ex(0.5, 6);
    s.aAtk = rr() < 0.15 ? lin(1, 15) : 0; s.aHold = 0; s.aDec = ex(800, 6000); s.aCurve = lin(0.3, 0.7);
    s.aSus = rr() < 0.5 ? 0 : lin(0.3, 1); s.aRel = rr() < 0.2 ? ex(60, 400) : ex(5, 60);
  }
  if (ch('noise')) {
    s.nLvl = rr() < 0.75 ? 0 : lin(0.05, 0.35); s.nType = pick([0, 1, 2]); s.nCut = ex(500, 8000); s.nRes = lin(0, 0.5); s.nAtk = lin(0, 20); s.nDec = ex(30, 400);
  }
  if (ch('filter')) {
    s.fType = pick([1, 1, 1, 1, 1, 1, 1, 1, 2, 0]);
    s.fCut = ex(300, 6000); s.fRes = lin(0, 0.75); s.fDrive = rr() < 0.6 ? 0 : lin(0.05, 0.6);
    s.fEnv = lin(-0.2, 0.9); s.fEnvDec = ex(60, 800); s.kTrack = lin(0.2, 0.5);
  }
  if (ch('mod')) {
    s.lShape = pick([0, 0, 1, 2, 3, 4]); s.lRate = ex(0.2, 12); s.lDepth = lin(0.05, 0.4); s.lDest = pick([2, 2, 3, 3, 7, 4]); s.lDest2 = 0; s.lRetrig = rr() < 0.5 ? 1 : 0;
    s.bits = rr() < 0.2 ? lin(8, 14) : 16; s.srDiv = rr() < 0.15 ? ex(2, 8) : 1;
    s.vFm = lin(0.1, 0.7); s.vPitch = 0; s.vFilt = lin(0, 0.7);
  }
  return soundTidy(s);
}
// a variation: every continuous control moves up to about a tenth of its dial either way; switches and types stay
const SND_ALTER_KEEP = new Set(['level', 'accent', 'slide']);
function soundAlter(cur, rr = Math.random) {
  const s = { ...cur };
  for (const p of FM_PARAMS) {
    if (p.curve === 'int' || SND_ALTER_KEEP.has(p.id)) continue;
    if (/^r[A-D]$/.test(p.id) && cur['fx' + p.id[1]] < 0.5) continue; // ratios stay on their whole and half numbers
    s[p.id] = fmFromNorm(p, fmToNorm(p, cur[p.id]) + (rr() * 2 - 1) * 0.09);
  }
  return soundTidy(s);
}
function soundTidy(s) { for (const p of FM_PARAMS) { let v = Math.min(p.max, Math.max(p.min, +s[p.id])); if (!isFinite(v)) v = p.def; s[p.id] = p.curve === 'int' ? Math.round(v) : +v.toPrecision(4); } return s; }

// how loud a sound is, the way ears hear it (fm/dm's measure: the lows below 60 Hz cut, the presence region and the top
// counted extra, the loudest 50 ms window), playing two bass notes, one accented, at level 1
const SND_SR = 96000;
function soundLoudness(sound) {
  const v = new FmVoice(SND_SR, 1);
  for (const p of FM_PARAMS) v.setParam(p.id, p.id === 'level' ? 1 : sound[p.id] ?? p.def);
  const hp = new FmSvf(); hp.set(60, 0, SND_SR);
  const pres = new FmSvf(); pres.set(3500, 0.35, SND_SR);
  const air = new FmSvf(); air.set(8000, 0, SND_SR);
  const W = Math.round(SND_SR * 0.05), N = Math.round(SND_SR * 0.5), on2 = N >> 1, off = Math.round(SND_SR * 0.11);
  let acc = 0, n = 0, best = 0, peak = 0;
  for (let i = 0; i < N; i++) {
    if (i === 0) v.noteOn(21, true, false); else if (i === on2) v.noteOn(33, false, false);
    if (i === off || i === on2 + off) v.noteOff();
    v.tick();
    const x = v.mono, ax = x < 0 ? -x : x; if (ax > peak) peak = ax;
    hp.tick(x); const y = hp.hp; pres.tick(y); air.tick(y);
    const w = y + pres.bp * 1.0 + air.hp * 0.7;
    acc += w * w;
    if (++n === W) { if (acc / W > best) best = acc / W; acc = 0; n = 0; }
  }
  return { db: 10 * Math.log10(best + 1e-12), peak };
}
// sets the sound's Level so it is as loud as the default sound (which every effect after the voice is calibrated to)
let sndRef = null;
function soundLevel(sound) {
  if (sndRef === null) { const d = Object.fromEntries(FM_PARAMS.map(p => [p.id, p.def])); sndRef = soundLoudness(d).db + 20 * Math.log10(d.level); }
  const m = soundLoudness(sound); if (m.peak < 1e-4) return sound; // silent: leave it
  const lv = FM_PARAMS[FM_P.level];
  return { ...sound, level: +Math.min(lv.max, Math.max(0.05, Math.pow(10, (sndRef - m.db) / 20))).toPrecision(3) };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { soundRandom, soundAlter, soundLevel, soundLoudness, soundTidy };
