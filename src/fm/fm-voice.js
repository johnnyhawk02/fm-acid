/*
 * fm/dm FM voice
 * --------------
 * One FM voice from fm/dm (github.com/johnnyhawk02/fm-drum-machine): its src/engine/dsp.js, params.js and voice.js
 * in one plain script. 4 operators, 8 algorithms, pitch envelope, click, noise, state-variable filter with drive,
 * amp envelope, bit crusher, an LFO with two destinations, velocity response, humanise, FM noise and drift,
 * turned from a drum into a monophonic synth voice that plays notes, accents and slides.
 * No dependencies: it runs in Node, in a browser and inside an AudioWorklet.
 *
 * MIT License
 *
 * Copyright (c) 2026 Johnny Hawk
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// ---------------------------------------------------------------------------
// small DSP building blocks (fm/dm dsp.js). No allocation after construction.
const FM_SIN_BITS = 12;
const FM_SIN_SIZE = 1 << FM_SIN_BITS;
const FM_SIN_MASK = FM_SIN_SIZE - 1;
const FM_SIN_TABLE = new Float32Array(FM_SIN_SIZE + 1);
for (let i = 0; i <= FM_SIN_SIZE; i++) FM_SIN_TABLE[i] = Math.sin((2 * Math.PI * i) / FM_SIN_SIZE);

// sine of x cycles (any real x), linear interpolation
function fmSin(x) {
  const f = (x - Math.floor(x)) * FM_SIN_SIZE;
  const i = f | 0;
  const fr = f - i;
  const a = FM_SIN_TABLE[i & FM_SIN_MASK];
  return a + (FM_SIN_TABLE[(i & FM_SIN_MASK) + 1] - a) * fr;
}

// soft clip, cheap tanh-like (exact at 0, saturates to ±1)
function fmSoftclip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// xorshift32 noise, deterministic for a seed
class FmRng {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    let s = this.s;
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    this.s = s;
    return s;
  }
  // -1..1
  bi() {
    return this.next() / 2147483648 - 1;
  }
  // 0..1
  uni() {
    return this.next() / 4294967296;
  }
}

// time constant (ms) to per-sample multiplier reaching -60 dB at t
function fmDecayCoef(ms, sr) {
  const n = Math.max(1, (ms * sr) / 1000);
  return Math.exp(-6.907755 / n);
}

// Topology-preserving state variable filter (trapezoidal integration)
class FmSvf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 2;
    this.lp = 0;
    this.bp = 0;
    this.hp = 0;
  }
  set(fc, res, sr) {
    const nyq = sr * 0.49;
    if (fc > nyq) fc = nyq;
    if (fc < 10) fc = 10;
    const g = Math.tan((Math.PI * fc) / sr);
    const k = 2 - 1.96 * (res < 0 ? 0 : res > 1 ? 1 : res);
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
  }
  reset() {
    this.ic1 = this.ic2 = 0;
  }
}

// one-pole lowpass/highpass helper
class FmOnePole {
  constructor() {
    this.z = 0;
    this.a = 0;
  }
  set(fc, sr) {
    this.a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  }
  lp(x) {
    this.z += this.a * (x - this.z);
    return this.z;
  }
  hp(x) {
    this.z += this.a * (x - this.z);
    return x - this.z;
  }
}

// ---------------------------------------------------------------------------
// the parameter block (fm/dm params.js): every value in real units (Hz, ms, 0..1 amounts)
// curve: 'lin' | 'exp' (min must be > 0) | 'int' (stepped) | 'bip' (bipolar lin)
// [id, min, max, default, curve, label]
const FM_SPEC = [
  // ---- tone / fm
  ['algo', 0, 7, 0, 'int', 'algo'],
  ['fmLvl', 0, 1, 0.6, 'lin', 'fm lvl'],
  ['fmDecay', 0.25, 4, 1, 'exp', 'fm decay'], // multiplies every modulator's own decay: one knob for how fast the FM brightness falls
  ['fb', -1, 1, 0, 'bip', 'fdbk'], // below 0 the feedback is squared: a rougher, asymmetric colour
  ['fmEnd', 0, 1, 0, 'lin', 'fm end'], // modulator envelopes settle at this level instead of 0
  ['phase', 0, 1, 0, 'int', '90° start'],
  ['drift', -1, 1, 0, 'bip', 'drift'], // fixed Hz offset (±40 Hz) on the modulators: slow beating that does not follow pitch
  ['fmNoise', 0, 1, 0, 'lin', 'fm noise'], // filtered noise wobbles the operator pitches, following the noise envelope
  ['hum', 0, 1, 0, 'lin', 'humanise'], // per-hit random: up to ±25 cents pitch and ±20% FM index // carriers start at 90°, modulators at 180°: a harder first transient
  // operator A..D: ratio, level, attack, decay, curve, fixed
  ...['A', 'B', 'C', 'D'].flatMap((o) => [
    [`r${o}`, 0.125, 16, 1, 'exp', `ratio ${o}`],
    [`l${o}`, 0, 1, o === 'A' ? 1 : o === 'B' ? 0.8 : 0, 'lin', `level ${o}`],
    [`a${o}`, 0, 200, 0, 'lin', `atk ${o}`],
    [`d${o}`, 1, 4000, o === 'A' ? 4000 : 200, 'exp', `dec ${o}`],
    [`fx${o}`, 0, 1, 0, 'int', `fixed ${o}`],
  ]),
  // pitch envelope
  ['pAmt', 0, 48, 0, 'lin', 'p amt'],
  ['pDec', 1, 1000, 40, 'exp', 'p dec'],
  // click / transient
  ['clk', 0, 1, 0, 'lin', 'click'],
  ['clkType', 0, 2, 0, 'int', 'clk typ'],
  ['clkDec', 0.1, 30, 2, 'exp', 'clk dec'],
  // noise
  ['nLvl', 0, 1, 0, 'lin', 'noise'],
  ['nType', 0, 2, 2, 'int', 'n flt'],
  ['nCut', 40, 18000, 6000, 'exp', 'n cut'],
  ['nRes', 0, 1, 0.2, 'lin', 'n res'],
  ['nAtk', 0, 100, 0, 'lin', 'n atk'],
  ['nDec', 1, 3000, 150, 'exp', 'n dec'],
  // main filter
  ['fType', 0, 3, 1, 'int', 'flt'], // 0 off, 1 lp, 2 bp, 3 hp
  ['fCut', 20, 20000, 2000, 'exp', 'cutoff'],
  ['fRes', 0, 1, 0.3, 'lin', 'reso'],
  ['fDrive', 0, 1, 0, 'lin', 'drive'],
  ['fEnv', -1, 1, 0.5, 'bip', 'f env'],
  ['fEnvDec', 1, 2000, 200, 'exp', 'f dec'],
  ['kTrack', 0, 1, 0.3, 'lin', 'key track'], // the cutoff follows the note: 1/3 is exact (an octave of cutoff per octave of pitch), 1 is three times that
  // amp
  ['aAtk', 0, 100, 0, 'lin', 'attack'],
  ['aHold', 0, 500, 0, 'lin', 'hold'],
  ['aDec', 5, 6000, 3000, 'exp', 'decay'],
  ['aSus', 0, 1, 0, 'lin', 'sustain'], // the level the amp envelope decays to while the note is held
  ['aRel', 1, 2000, 8, 'exp', 'release'], // after note-off, from wherever the envelope is
  ['aCurve', 0, 1, 0.5, 'lin', 'curve'],
  ['level', 0, 1, 0.5, 'lin', 'level'], // set by Randomise and Alter so every sound is about as loud
  // playing it as a synth
  ['slide', 10, 500, 60, 'exp', 'slide'], // ms a legato note takes to arrive (95% of the way)
  ['accent', 0, 1, 0.7, 'lin', 'accent'], // unaccented notes play at velocity 1 - 0.6 * accent, accented ones at 1
  // crush
  ['bits', 1, 16, 16, 'lin', 'bits'],
  ['srDiv', 1, 64, 1, 'exp', 'rate'],
  // lfo
  ['lShape', 0, 4, 0, 'int', 'lfo shp'],
  ['lRate', 0.05, 40, 2, 'exp', 'lfo rate'],
  ['lDepth', 0, 1, 0, 'lin', 'lfo amt'],
  ['lDest', 0, 7, 0, 'int', 'lfo dst'],
  ['lDest2', 0, 7, 0, 'int', 'lfo dst2'],
  ['lRetrig', 0, 1, 1, 'int', 'retrig'],
  // velocity
  ['vLvl', 0, 1, 0.6, 'lin', 'v lvl'],
  ['vPitch', 0, 1, 0, 'lin', 'v pitch'],
  ['vFm', 0, 1, 0.3, 'lin', 'v fm'],
  ['vFilt', 0, 1, 0.4, 'lin', 'v flt'],
];

const FM_LFO_DESTS = ['off', 'pitch', 'fm', 'cutoff', 'level', 'pan', 'noise', 'ratio'];
const FM_LFO_SHAPES = ['sine', 'tri', 'saw', 'square', 's&h'];
const FM_ALGOS = ['D>C>B>A', 'C+D>B>A', 'D>C B>A', 'B+C+D>A', 'D>ABC', 'D>C>A B>A', 'D>C A B', 'A B C D'];
const FM_FILTER_TYPES = ['off', 'lp', 'bp', 'hp'];
const FM_NOISE_TYPES = ['lp', 'bp', 'hp'];
const FM_CLICK_TYPES = ['pulse', 'tick', 'blip'];

const FM_PARAMS = FM_SPEC.map(([id, min, max, def, curve, label], i) => ({ id, i, min, max, def, curve, label }));
const FM_NP = FM_PARAMS.length;
const FM_P = Object.fromEntries(FM_PARAMS.map((p) => [p.id, p.i]));

function fmToNorm(p, v) {
  if (p.curve === 'exp') return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / (p.max - p.min);
}
function fmFromNorm(p, n) {
  n = n < 0 ? 0 : n > 1 ? 1 : n;
  if (p.curve === 'exp') return p.min * Math.pow(p.max / p.min, n);
  const v = p.min + n * (p.max - p.min);
  return p.curve === 'int' ? Math.round(v) : v;
}

function fmDefaults() {
  return FM_PARAMS.map((p) => p.def);
}

// ---------------------------------------------------------------------------
// the voice (fm/dm voice.js), played as a monophonic synth
//
// fm/dm triggers a hit and lets it decay. Here the voice takes notes instead:
//   noteOn(code, accent, slide)   code 33 = A = 110 Hz; slide = glide from the note sounding, no retrigger
//   noteOff()                     the amp envelope releases from wherever it is
//   setParam(id, value)           real units, as in FM_PARAMS
//   process(out, start, end)      mono, at the rate given to the constructor
// What was added to the drum voice: pitch from the note (with Tuning and a per-note fine tune), slide, sustain and
// release on the amp envelope, accent as velocity, filter key track and the FM decay multiplier. Everything else is
// fm/dm's, sample for sample (tests/bitmatch.mjs).
const FM_CTRL = 16; // control-rate block
const FM_FADE_N = 64; // retrigger fade, samples
const FM_KT_REF = 110 * Math.pow(2, 3 / 12); // key track pivots on the C above the 110 Hz A: that note's cutoff does not move
const fmLm = (d1, d2, d, l) => (d1 === d ? l : 0) + (d2 === d ? l : 0);
const fmNoteHz = (code) => 110 * Math.pow(2, (code - 33) / 12);

// algorithms: modulator bitmask per op [A,B,C,D] and carrier mask (bit0=A)
const FM_ALG_MOD = [
  [0b0010, 0b0100, 0b1000, 0],
  [0b0010, 0b1100, 0, 0],
  [0b0010, 0, 0b1000, 0],
  [0b1110, 0, 0, 0],
  [0b1000, 0b1000, 0b1000, 0],
  [0b0110, 0, 0b1000, 0],
  [0, 0, 0b1000, 0],
  [0, 0, 0, 0],
];
const FM_ALG_CAR = [0b0001, 0b0001, 0b0101, 0b0001, 0b0111, 0b0001, 0b0111, 0b1111];

class FmVoice {
  constructor(sr, seed) {
    this.sr = sr;
    this.p = Float32Array.from(fmDefaults()); // the parameter block, real units
    this.rng = new FmRng(seed);
    this.ph = new Float64Array(4); // op phases (cycles)
    this.inc = new Float64Array(4);
    this.env = new Float32Array(4); // op env values
    this.atkInc = new Float32Array(4);
    this.decC = new Float32Array(4);
    this.stage = new Uint8Array(4); // 0 attack, 1 decay
    this.out = new Float32Array(4);
    this.fbz = 0;
    this.fbz2 = 0;
    this.filt = new FmSvf();
    this.nfilt = new FmSvf();
    this.lfoPh = 0;
    this.lfoVal = 0;
    this.lfoSH = 0;
    this.lPitch = this.lFm = this.lCut = this.lLvl = this.lNoise = this.lRatio = 0;
    this.velAmp = 1;
    this.fmIdx = 0;
    this.fade = 0;
    this.pendVel = 1;
    this.pendHz = 110;
    this.incBase = new Float64Array(4);
    this.aa = new Float32Array(4).fill(1);
    this.wob = new FmOnePole();
    this.wobAmt = 0;
    this.hPitch = 1;
    this.hIdx = 1;
    this.driftInc = 0;
    this.fixedMask = 0;
    this.pSemis = 0;
    // the note
    this.gate = false;
    this.hz = 110;      // the pitch sounding (it glides to hzTo on a slide)
    this.hzTo = 110;
    this.gliding = false;
    this.tuneMul = 1;   // the Tuning dial, as a frequency ratio
    this.tuneCents = new Float64Array(12); // fine tune per note of the scale, C first
    this.rel = 1;       // release gain: 1 while the note is held, falling after note-off
    this.relC = 1;
    this.reset();
    this.mono = 0;
  }

  setParam(id, value) { const i = FM_P[id]; if (i !== undefined) this.p[i] = value; }
  getParam(id) { return this.p[FM_P[id]]; }
  // the front panel's Tuning, in semitones; it moves a sounding note too
  setTuning(semis) { this.tuneMul = Math.pow(2, semis / 12); }
  // cents: 12 offsets, C first (code 0 is a C); the next note picks it up, a held note keeps its pitch
  setTune(cents) { for (let i = 0; i < 12; i++) this.tuneCents[i] = +(cents && cents[i]) || 0; }

  // code: the note number (33 = A = 110 Hz, a semitone a step). accent: true or false.
  // slide: true when this note should glide from the one sounding (legato): the envelopes do not restart.
  noteOn(code, accent, slide) {
    code = Math.max(0, Math.min(127, code | 0));
    const c = this.tuneCents[code % 12], hz = c ? fmNoteHz(code) * Math.pow(2, c / 1200) : fmNoteHz(code);
    if (this.gate && slide && this.active) { this.hzTo = hz; this.gliding = true; return; }
    this.gate = true;
    this.hit(hz, accent ? 1 : 1 - 0.6 * this.p[FM_P.accent]);
  }
  noteOff() {
    if (!this.gate) return;
    this.gate = false;
    this.relC = fmDecayCoef(this.p[FM_P.aRel], this.sr);
  }

  // A new note on a sounding voice first fades the old one out over FM_FADE_N samples (no click),
  // then starts. A silent voice starts at once. (fm/dm's trigger, with the pitch.)
  hit(hz, vel) {
    if (this.active && (this.amp > 1e-3 || this.nEnv > 1e-3 || this.clkEnv > 1e-3)) {
      this.fade = FM_FADE_N;
      this.pendVel = vel;
      this.pendHz = hz;
      return;
    }
    this.start(hz, vel);
  }

  start(hz, vel) {
    const sr = this.sr, p = this.p, b = 0;
    this.fade = 0;
    this.active = true;
    this.vel = vel;
    this.hz = this.hzTo = hz;
    this.gliding = false;
    this.rel = 1;
    this.t = 0;
    const car0 = FM_ALG_CAR[p[b + FM_P.algo] | 0];
    const ninety = p[b + FM_P.phase] >= 0.5;
    const fmDec = p[b + FM_P.fmDecay];
    for (let o = 0; o < 4; o++) {
      const base = FM_P.rA + o * 5;
      this.ph[o] = ninety ? ((car0 >> o) & 1 ? 0.25 : 0.5) : 0;
      this.env[o] = 0;
      const atk = p[b + base + 2];
      this.atkInc[o] = atk <= 0.05 ? 2 : 1000 / (atk * sr);
      this.stage[o] = 0;
      this.decC[o] = fmDecayCoef((car0 >> o) & 1 ? p[b + base + 3] : p[b + base + 3] * fmDec, sr);
    }
    this.fbz = this.fbz2 = 0;
    // amp
    this.ampStartLvl = 0;
    this.ampStage = 0;
    this.ampX = 0;
    const aAtk = p[b + FM_P.aAtk];
    this.ampAtkInc = aAtk <= 0.05 ? 2 : 1000 / (aAtk * sr);
    this.ampHoldN = (p[b + FM_P.aHold] * sr) / 1000;
    this.ampDecInc = 1000 / (p[b + FM_P.aDec] * sr);
    this.ampK = Math.pow(2, p[b + FM_P.aCurve] * 4 - 1);
    // pitch, filter env, click
    this.pEnv = 1;
    this.pC = fmDecayCoef(p[b + FM_P.pDec], sr);
    this.fEnv = 1;
    this.fC = fmDecayCoef(p[b + FM_P.fEnvDec], sr);
    this.clkEnv = 1;
    this.clkC = fmDecayCoef(p[b + FM_P.clkDec], sr);
    this.clkPh = 0;
    // noise
    this.nStage = 0;
    this.nEnv = 0;
    const nAtk = p[b + FM_P.nAtk];
    this.nAtkInc = nAtk <= 0.05 ? 2 : 1000 / (nAtk * sr);
    this.nC = fmDecayCoef(p[b + FM_P.nDec], sr);
    this.rng.next(); // fm/dm draws the first noise-burst gap here; the bursts are gone, the draw stays so the random stream is the same
    if (p[b + FM_P.lRetrig] >= 0.5) this.lfoPh = 0;
    // humanise: a fresh random pitch and index offset for each hit
    const hum = p[b + FM_P.hum];
    this.hPitch = Math.pow(2, (this.rng.bi() * hum * 25) / 1200);
    this.hIdx = 1 + this.rng.bi() * hum * 0.2;
    this.wob.z = 0;
    this.ctr = 0;
    // a note-off that came during the retrigger fade
    if (!this.gate) this.relC = fmDecayCoef(p[b + FM_P.aRel], sr);
  }

  reset() {
    this.active = false;
    this.vel = 1;
    this.t = 0; // samples since trigger
    this.amp = 0;
    this.ampX = 0;
    this.ampStage = 3; // 0 atk 1 hold 2 dec 3 idle 4 sustain
    this.pEnv = 0;
    this.fEnv = 0;
    this.clkEnv = 0;
    this.nEnv = 0;
    this.nStage = 2;
    this.crushHold = 0;
    this.crushN = 0;
    this.ctr = 0;
    this.filt.reset();
    this.nfilt.reset();
  }

  // control-rate update
  control() {
    const sr = this.sr, p = this.p, b = 0;
    const dt = FM_CTRL / sr;
    // lfo
    const rate = p[b + FM_P.lRate];
    let ph = this.lfoPh + rate * dt;
    if (ph >= 1) {
      ph -= Math.floor(ph);
      this.lfoSH = this.rng.bi();
    }
    this.lfoPh = ph;
    const shape = p[b + FM_P.lShape] | 0;
    let l;
    if (shape === 0) l = fmSin(ph);
    else if (shape === 1) l = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
    else if (shape === 2) l = 1 - 2 * ph;
    else if (shape === 3) l = ph < 0.5 ? 1 : -1;
    else l = this.lfoSH;
    l *= p[b + FM_P.lDepth];
    this.lfoVal = l;
    const d1 = p[b + FM_P.lDest] | 0;
    const d2 = p[b + FM_P.lDest2] | 0;
    this.lPitch = fmLm(d1, d2, 1, l) * 12;
    this.lFm = fmLm(d1, d2, 2, l);
    this.lCut = fmLm(d1, d2, 3, l) * 4;
    this.lLvl = fmLm(d1, d2, 4, l);
    this.lNoise = fmLm(d1, d2, 6, l);
    this.lRatio = fmLm(d1, d2, 7, l);

    // slide: the pitch glides to the new note in log frequency, a one-pole that is 95% there after the slide time
    if (this.gliding) {
      const a = 1 - Math.exp((-3 * FM_CTRL * 1000) / (p[b + FM_P.slide] * sr));
      const cur = Math.log2(this.hz), to = Math.log2(this.hzTo), nx = cur + (to - cur) * a;
      if (Math.abs(to - nx) < 1e-5) { this.hz = this.hzTo; this.gliding = false; } else this.hz = Math.pow(2, nx);
    }

    const vel = this.vel;
    // pitch
    // the pitch envelope itself runs per sample (see process); here the rest of the pitch
    this.pSemis = p[b + FM_P.pAmt] * (1 - p[b + FM_P.vPitch] * (1 - vel));
    const note = this.hz * this.tuneMul;
    const f0 = note * Math.pow(2, this.lPitch / 12);
    const rmul = Math.pow(2, this.lRatio * 2);
    const car = FM_ALG_CAR[p[b + FM_P.algo] | 0];
    let fixed = 0;
    for (let o = 0; o < 4; o++) {
      const base = b + FM_P.rA + o * 5;
      const fx = p[base + 4] >= 0.5;
      let f = fx ? p[base] * 1000 : p[base] * f0;
      if (fx) fixed |= 1 << o;
      if (!((car >> o) & 1)) f *= rmul;
      this.incBase[o] = (fx ? f : f * this.hPitch) / sr;
    }
    this.driftInc = (p[b + FM_P.drift] * 40) / sr;
    // fm noise: the wobble is low-passed at a few times the pitch, scaled to the operator's own frequency
    this.wobAmt = p[b + FM_P.fmNoise] * 2;
    if (this.wobAmt > 0) this.wob.set(Math.min(9000, f0 * 8), sr);
    this.fixedMask = fixed;
    // FM index into each operator shrinks as that operator's pitch rises, so sidebands stay below
    // Nyquist (cheap anti-aliasing): 20 * (0.5 - f/sr)^4, capped at 1
    for (let o = 0; o < 4; o++) {
      const fr = this.incBase[o] * (this.fixedMask >> o & 1 ? 1 : Math.pow(2, (this.pEnv * this.pSemis) / 12));
      const q = 0.5 - (fr > 0.5 ? 0.5 : fr);
      const a = 20 * q * q * q * q;
      this.aa[o] = a > 1 ? 1 : a;
    }
    // filter
    const ft = p[b + FM_P.fType] | 0;
    if (ft) {
      const kt = p[b + FM_P.kTrack];
      const oct = p[b + FM_P.fEnv] * this.fEnv * 6 + this.lCut - p[b + FM_P.vFilt] * (1 - vel) * 3 + (kt > 0 ? kt * 3 * Math.log2(note / FM_KT_REF) : 0);
      this.filt.set(p[b + FM_P.fCut] * Math.pow(2, oct), p[b + FM_P.fRes], sr);
    }
    this.nfilt.set(p[b + FM_P.nCut], p[b + FM_P.nRes], sr);
    // velocity scalars
    this.velAmp = 1 - p[b + FM_P.vLvl] * (1 - vel);
    const fmv = p[b + FM_P.fmLvl];
    this.fmIdx = fmv * fmv * 4 * (1 - p[b + FM_P.vFm] * (1 - vel)) * (1 + this.lFm) * this.hIdx;
  }

  // out[start..end) gets the voice, mono
  process(out, start = 0, end = out.length) {
    for (let n = start; n < end; n++) { this.tick(); out[n] = this.mono; }
  }

  // one sample, left in this.mono
  tick() {
    if (!this.active) {
      this.mono = 0;
      return;
    }
    const p = this.p, b = 0;
    if (this.ctr === 0) this.control();
    this.ctr = (this.ctr + 1) % FM_CTRL;

    // ---- pitch envelope, per sample
    const pm = this.pSemis !== 0 ? Math.pow(2, (this.pEnv * this.pSemis) / 12) : 1;
    for (let o = 0; o < 4; o++) this.inc[o] = (this.fixedMask >> o) & 1 ? this.incBase[o] : this.incBase[o] * pm;
    {
      const car = FM_ALG_CAR[p[b + FM_P.algo] | 0];
      let w = 0;
      if (this.wobAmt > 0) w = this.wob.lp(this.rng.bi()) * this.wobAmt * this.nEnv;
      if (w !== 0 || this.driftInc !== 0) {
        // carriers wobble less (a fifth as much), and less again when the FM index is high
        const cw = w * 0.2 * (1 - Math.min(0.5, this.fmIdx * 2.5));
        for (let o = 0; o < 4; o++) {
          if ((car >> o) & 1) this.inc[o] *= 1 + cw;
          else this.inc[o] = this.inc[o] * (1 + w) + this.driftInc;
        }
      }
    }

    // ---- operator envelopes
    const env = this.env;
    for (let o = 0; o < 4; o++) {
      if (this.stage[o] === 0) {
        env[o] += this.atkInc[o];
        if (env[o] >= 1) {
          env[o] = 1;
          this.stage[o] = 1;
        }
      } else env[o] *= this.decC[o];
    }

    // ---- release: after note-off everything the gate holds up (the amp envelope, the modulators' FM end level, the
    // noise) falls away over the release time
    const rel = this.rel;
    if (!this.gate && this.fade === 0) this.rel *= this.relC;

    // ---- FM operators, D down to A
    const algo = p[b + FM_P.algo] | 0;
    const mods = FM_ALG_MOD[algo];
    const car = FM_ALG_CAR[algo];
    const fmEnd = p[b + FM_P.fmEnd];
    const out = this.out;
    const idx = this.fmIdx;
    let body = 0;
    let ncar = 0;
    for (let o = 3; o >= 0; o--) {
      let m = 0;
      const mask = mods[o];
      if (mask) {
        for (let j = o + 1; j < 4; j++) if ((mask >> j) & 1) m += out[j];
        m *= idx * this.aa[o];
      }
      if (o === 3) {
        // feedback follows D's own envelope, so the grit fades with the attack;
        // negative feedback uses the squared signal (asymmetric, rougher)
        const fb = p[b + FM_P.fb];
        if (fb !== 0) {
          const z = (this.fbz + this.fbz2) * 0.5;
          m += (fb > 0 ? z : z * z * 2 - 0.5) * fb * 1.2 * env[3] * this.aa[3];
        }
      }
      let ph = this.ph[o] + this.inc[o];
      if (ph >= 1) ph -= 1;
      this.ph[o] = ph;
      const lvl = p[b + FM_P.lA + o * 5];
      // a modulator settles at FM end while the note is held (the FM sustain) and goes to zero with the release
      const e = (car >> o) & 1 ? env[o] : fmEnd * rel + (1 - fmEnd) * env[o];
      const y = fmSin(ph + m) * e * lvl;
      out[o] = y;
      if ((car >> o) & 1) {
        body += y;
        ncar++;
      }
    }
    this.fbz2 = this.fbz;
    this.fbz = out[3];
    if (ncar > 1) body *= 1 / Math.sqrt(ncar);

    // ---- amp env (applies to FM body): attack, hold, decay towards the sustain level, held there while the note is
    let a;
    if (this.ampStage === 0) {
      this.ampX += this.ampAtkInc;
      if (this.ampX >= 1) {
        this.ampX = 0;
        this.ampStage = this.ampHoldN > 0 ? 1 : 2;
        a = 1;
      } else a = this.ampStartLvl + (1 - this.ampStartLvl) * this.ampX;
    } else if (this.ampStage === 1) {
      a = 1;
      this.ampX += 1;
      if (this.ampX >= this.ampHoldN) {
        this.ampX = 0;
        this.ampStage = 2;
      }
    } else if (this.ampStage === 2) {
      const sus = p[b + FM_P.aSus];
      this.ampX += this.ampDecInc;
      if (this.ampX >= 1) {
        this.ampStage = sus > 0 ? 4 : 3;
        a = sus;
      } else a = sus + (1 - sus) * Math.pow(1 - this.ampX, this.ampK);
    } else if (this.ampStage === 4) a = p[b + FM_P.aSus];
    else a = 0;
    a *= rel;
    if (rel < 1e-4) { // released
      a = 0;
      this.ampStage = 3;
      this.nEnv = 0;
    }
    this.amp = a;
    body *= a;

    // ---- click
    let clk = 0;
    const ck = p[b + FM_P.clk];
    if (ck > 0 && this.clkEnv > 1e-4) {
      const ct = p[b + FM_P.clkType] | 0;
      if (ct === 0) clk = this.clkEnv;
      else if (ct === 1) clk = this.rng.bi() * this.clkEnv;
      else {
        this.clkPh += 3000 / this.sr;
        clk = fmSin(this.clkPh) * this.clkEnv;
      }
      clk *= ck;
    }
    this.clkEnv *= this.clkC;

    // ---- noise
    let nz = 0;
    const nl = p[b + FM_P.nLvl] * (1 + this.lNoise);
    if (this.nStage === 0) {
      this.nEnv += this.nAtkInc;
      if (this.nEnv >= 1) {
        this.nEnv = 1;
        this.nStage = 1;
      }
    } else if (this.nStage === 1) this.nEnv *= this.nC;
    if (nl > 0 && this.nEnv > 1e-5) {
      this.nfilt.tick(this.rng.bi());
      const nt = p[b + FM_P.nType] | 0;
      nz = (nt === 0 ? this.nfilt.lp : nt === 1 ? this.nfilt.bp : this.nfilt.hp) * this.nEnv * nl * rel;
    }

    // ---- sum, drive, filter
    let x = body + clk + nz;
    const drv = p[b + FM_P.fDrive];
    if (drv > 0) {
      const g = 1 + drv * 12;
      x = fmSoftclip(x * g) / Math.sqrt(g) * (1 + drv * 0.3);
    }
    const ft = p[b + FM_P.fType] | 0;
    if (ft) {
      this.filt.tick(x);
      x = ft === 1 ? this.filt.lp : ft === 2 ? this.filt.bp * 1.5 : this.filt.hp;
    }

    // ---- crush
    const bits = p[b + FM_P.bits];
    const div = p[b + FM_P.srDiv];
    if (div > 1.01) {
      this.crushN += 1;
      if (this.crushN >= div) {
        this.crushN -= div;
        this.crushHold = x;
      }
      x = this.crushHold;
    }
    if (bits < 15.9) {
      const q = Math.pow(2, bits - 1);
      x = Math.round(x * q) / q;
    }

    // ---- level
    const lv = p[b + FM_P.level] * this.velAmp * (1 - Math.abs(this.lLvl) * 0.5 + this.lLvl * 0.5);
    x *= lv;
    if (this.fade > 0) x *= this.fade / FM_FADE_N;
    this.mono = x;

    // ---- retrigger fade done: start the new note
    if (this.fade > 0 && --this.fade === 0) {
      this.start(this.pendHz, this.pendVel);
      return;
    }

    // ---- envelopes advance
    this.pEnv *= this.pC;
    this.fEnv *= this.fC;
    this.t++;
    if (this.ampStage === 3 && this.nEnv < 1e-5 && this.clkEnv < 1e-4 && this.t > 64) {
      this.active = false;
      this.amp = 0;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { FmVoice, fmNoteHz, FM_PARAMS, FM_NP, FM_P, fmToNorm, fmFromNorm, fmDefaults, FM_ALGOS, FM_LFO_DESTS, FM_LFO_SHAPES, FM_FILTER_TYPES, FM_NOISE_TYPES, FM_CLICK_TYPES, FmRng, FmSvf, FmOnePole, fmSin, fmSoftclip, fmDecayCoef };
