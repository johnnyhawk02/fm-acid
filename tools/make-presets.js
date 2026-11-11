// Writes factory-presets.json: the Factory presets in the Preset menu.
//   node tools/make-presets.js /path/to/tb303-circuit-model
// Each preset is a whole project in the shape Export saves: an FM sound written here by hand (real units, anything not
// listed is the default), a pattern from the app's own Generate (src/js/app/generate.js), a name from the app's own
// namer (src/js/app/namer.js), and the effects of one of the 303 app's factory presets (read from that repo's
// factory-presets.json), with the Compactor at 30% and 250 ms on all of them. Every sound's Level is set so that, playing its
// pattern with the effects off, it is as loud as the default sound playing the default pattern. The random choices are seeded, so a rerun writes the same file.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const from = process.argv[2] || process.env.TB303;
if (!from) { console.error('usage: node tools/make-presets.js /path/to/tb303-circuit-model'); process.exit(1); }
const OLD = JSON.parse(fs.readFileSync(path.join(from, 'factory-presets.json'), 'utf8'));
const { FM_PARAMS, SynthEngine } = require(path.join(root, 'src/synth.js'));
const { soundTidy } = require(path.join(root, 'src/js/app/soundgen.js'));
// how loud a sound is playing a pattern with the effects off (rms over four seconds)
function dryRms(fm, pattern, tuning = 0.5) {
  const e = new SynthEngine(48000, undefined, 1), N = 48000 * 4, L = new Float32Array(128), R = new Float32Array(128);
  for (const k in fm) e.message({ type: 'param', name: k, value: fm[k] });
  e.message({ type: 'knob', name: 'tuning', value: tuning }); e.message({ type: 'knob', name: 'cmpamt', value: 0 });
  e.message({ type: 'bpm', value: 128 }); e.message({ type: 'groove', shuffle: 0, gate: 0.5 }); e.message({ type: 'pattern', value: pattern }); e.message({ type: 'play', value: true });
  let sq = 0; for (let i = 0; i < N; i += 128) { e.render(L, R); for (let j = 0; j < 128; j++) sq += L[j] * L[j]; }
  return Math.sqrt(sq / N);
}

// the app's Generate and namer, with a seeded Math.random
let seed = 0x5eed1234;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const M = Object.create(Math); M.random = rnd;
const ctx = vm.createContext({ Math: M, store: { get: (k, d) => d, set() {} } });
for (const f of ['generate', 'namer']) vm.runInContext(fs.readFileSync(path.join(root, 'src/js/app', f + '.js'), 'utf8') + '\nthis.generatePattern = typeof generatePattern !== "undefined" ? generatePattern : this.generatePattern; this.NAMER = typeof NAMER !== "undefined" ? NAMER : this.NAMER;', ctx);

// what: the sound in a few words (not shown in the app). fx: the 303 factory preset whose effects it wears.
// len, dens: the Generate pattern. tuning: the Tuning dial in semitones.
const SOUNDS = [
  { what: 'FM acid bass', fx: 'Dyzon Zphere Velvetos', len: 16, dens: 0.7,
    fm: { fmLvl: 0.7, lB: 0.85, dB: 180, fCut: 600, fRes: 0.55, fEnv: 0.7, fEnvDec: 180, aDec: 2500, accent: 0.8, vFilt: 0.6 } },
  { what: 'rubbery 2:1 bass', fx: 'Hubble Flow Zero', len: 16, dens: 0.6,
    fm: { rB: 2, lB: 0.7, dB: 120, fmLvl: 0.55, fCut: 900, fRes: 0.2, fEnv: 0.35, fEnvDec: 140, aDec: 800, slide: 90, pAmt: 3, pDec: 25 } },
  { what: 'bell lead', fx: 'Meringides Nebula', len: 32, dens: 0.45, tuning: 12,
    fm: { algo: 2, rB: 3.5, lB: 0.6, dB: 900, rC: 2, lC: 0.7, rD: 7, lD: 0.4, dD: 400, dC: 1800, fmLvl: 0.5, fType: 0, aDec: 1800, aRel: 300, kTrack: 0.33, vFm: 0.5 } },
  { what: 'metallic 3.5 stab', fx: 'Angry Photon Mosz', len: 16, dens: 0.5,
    fm: { rB: 3.5, lB: 0.9, dB: 90, fmLvl: 0.85, fb: 0, fType: 2, fCut: 1800, fRes: 0.35, fEnv: 0.4, fEnvDec: 90, aDec: 250, aRel: 40, clk: 0.25, clkType: 1 } },
  { what: 'noisy breath', fx: 'Zupernova Otaleg', len: 32, dens: 0.4, tuning: 12,
    fm: { lB: 0.3, dB: 600, fmLvl: 0.4, fmNoise: 0.3, nLvl: 0.5, nType: 1, nCut: 2500, nRes: 0.4, nAtk: 20, nDec: 400, aAtk: 15, aSus: 0.6, aRel: 180, fCut: 3500, fRes: 0.15, fEnv: 0.2, slide: 120 } },
  { what: 'feedback growl', fx: 'Aphelion Prime', len: 16, dens: 0.65,
    fm: { algo: 0, lB: 0.6, dB: 300, lC: 0.5, dC: 500, lD: 0.7, dD: 800, fb: 0.7, fmLvl: 0.75, fCut: 500, fRes: 0.4, fEnv: 0.6, fEnvDec: 260, fDrive: 0.5, aDec: 2000 } },
  { what: 'hollow reed', fx: 'Logos Ladder', len: 16, dens: 0.55,
    fm: { algo: 3, rB: 2, lB: 0.5, dB: 1500, rC: 4, lC: 0.25, dC: 700, rD: 1, lD: 0.2, dD: 2000, fmLvl: 0.6, fmEnd: 0.4, fCut: 2600, fRes: 0.2, fEnv: 0.3, aAtk: 4, aSus: 0.7, aRel: 90, slide: 80 } },
  { what: 'sub thump bass', fx: 'Gorar-Fenozz Eroz', len: 16, dens: 0.5, tuning: -12,
    fm: { lB: 0.35, dB: 70, fmLvl: 0.5, pAmt: 12, pDec: 30, clk: 0.3, clkDec: 1.5, fCut: 320, fRes: 0.1, fEnv: 0.5, fEnvDec: 80, aDec: 900, kTrack: 0.2 } },
  { what: 'glass pluck', fx: 'Molten Pumice Wazabi', len: 32, dens: 0.5, tuning: 12,
    fm: { rB: 5, lB: 0.7, dB: 60, fmLvl: 0.65, fType: 0, aDec: 400, aRel: 120, vFm: 0.6, hum: 0.2 } },
  { what: 'wobble bass', fx: 'Draxudize', len: 16, dens: 0.6,
    fm: { rB: 1, lB: 0.9, dB: 2000, fmLvl: 0.7, fmEnd: 0.6, fCut: 450, fRes: 0.5, fEnv: 0.15, lShape: 0, lRate: 4, lDepth: 0.55, lDest: 3, lDest2: 2, lRetrig: 0, aSus: 0.8, aRel: 60, slide: 100 } },
  { what: 'crushed organ', fx: 'Ancho Penguin', len: 16, dens: 0.55,
    fm: { algo: 7, rA: 1, lA: 1, rB: 2, lB: 0.6, dB: 4000, rC: 3, lC: 0.4, dC: 4000, rD: 4, lD: 0.25, dD: 4000, fmLvl: 0.5, bits: 6, srDiv: 4, fCut: 5000, fRes: 0.1, fEnv: 0.1, aSus: 0.8, aRel: 50 } },
  { what: 'acid screamer', fx: 'Pulsar Echo', len: 16, dens: 0.75,
    fm: { rB: 1, lB: 1, dB: 400, fmLvl: 1, fmDecay: 2, fb: 0.25, lD: 0.3, algo: 1, lC: 0.4, fCut: 300, fRes: 0.75, fEnv: 0.9, fEnvDec: 220, fDrive: 0.6, accent: 0.9, vFilt: 0.7, slide: 70 } },
  { what: 'drifting detuned stab', fx: 'The Indigo Moth', len: 32, dens: 0.4,
    fm: { algo: 5, rB: 1, lB: 0.5, dB: 500, rC: 2, lC: 0.5, dC: 350, rD: 1, lD: 0.4, dD: 700, drift: 0.4, fmLvl: 0.6, fCut: 1500, fRes: 0.25, fEnv: 0.45, fEnvDec: 300, aAtk: 5, aSus: 0.6, aRel: 200 } },
  { what: 'fixed-frequency clang', fx: 'Zilux', len: 16, dens: 0.45,
    fm: { fxB: 1, rB: 0.62, lB: 0.75, dB: 150, fmLvl: 0.7, fType: 3, fCut: 180, fRes: 0.2, fEnv: 0, aDec: 500, aRel: 80, clk: 0.3, clkType: 2 } },
  { what: 'wooden mallet', fx: 'Cepheidax', len: 32, dens: 0.55,
    fm: { rB: 4, lB: 0.5, dB: 40, fmLvl: 0.6, clk: 0.4, clkType: 1, clkDec: 1, fCut: 3000, fRes: 0.1, fEnv: 0.3, fEnvDec: 60, aDec: 300, aRel: 60, kTrack: 0.33 } },
  { what: 'dark slide lead', fx: 'Galangal Mirage', len: 32, dens: 0.5,
    fm: { rB: 1.5, lB: 0.6, dB: 1200, fmLvl: 0.55, fmEnd: 0.3, fb: -0.3, algo: 0, lC: 0.3, dC: 900, fCut: 1100, fRes: 0.45, fEnv: 0.35, fEnvDec: 500, aSus: 0.7, aRel: 150, slide: 150, lRate: 5.5, lDepth: 0.08, lDest: 1 } },
];
const DROP = new Set(['cutoff', 'resonance', 'envmod', 'decay', 'accent']); // the 303 voice's dials
const DEF = Object.fromEntries(FM_PARAMS.map(p => [p.id, p.def]));
const EXAMPLE = [[21,1,0,1],[21,0,0,1],[33,0,1,1],[31,0,0,1],[21,1,0,1],[21,0,0,0],[24,0,1,1],[26,0,0,1],[21,0,0,1],[33,1,0,1],[28,0,1,1],[24,0,0,1],[21,1,1,1],[19,0,0,1],[21,0,0,0],[36,1,0,1]]
  .map(([code, accent, slide, gate]) => ({ code, accent: !!accent, slide: !!slide, gate: !!gate }));
const REF = dryRms(DEF, EXAMPLE);
const out = {};
for (const s of SOUNDS) {
  const old = OLD[s.fx]; if (!old) throw new Error('no 303 factory preset called ' + s.fx);
  for (const k in s.fm) if (!FM_PARAMS.some(p => p.id === k)) throw new Error(`${s.what}: no FM parameter called ${k}`);
  const fm = soundTidy({ ...DEF, ...s.fm });
  const knobs = Object.fromEntries(Object.entries(old.sound.knobs).filter(([k]) => !DROP.has(k)));
  Object.assign(knobs, { tuning: 0.5 + (s.tuning || 0) / 24, volume: 0.85, cmpamt: 0.3, cmprel: 0.5 });
  const fx = { rat: false, lex: false, dly: false, fold: false, flg: false, ...old.sound.fx };
  const g = ctx.generatePattern(s.len, s.dens);
  fm.level = +Math.min(1, Math.max(0.05, fm.level * REF / dryRms(fm, g.pattern, knobs.tuning))).toPrecision(3);
  const name = ctx.NAMER(out);
  out[name] = { sound: { knobs, fm, fx }, bpm: 128, sel: { g: 'A', n: 0 }, chain: [], banks: { A1: { shuffle: 0, gate: 0.5, pattern: g.pattern } } };
  console.log(name.padEnd(34), s.what.padEnd(24), 'level', fm.level, ' pattern:', g.src);
}
fs.writeFileSync(path.join(root, 'factory-presets.json'), JSON.stringify(out) + '\n');
console.log(`wrote factory-presets.json (${Object.keys(out).length} presets)`);
