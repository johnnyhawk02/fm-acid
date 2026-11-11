// The FM voice must sound exactly as it does in fm/dm. Renders fm/dm kit voices through fm/dm's own voice.js (a checkout
// of johnnyhawk02/fm-drum-machine: pass its path, or set FMDM) and through src/fm/fm-voice.js with the same seed and
// parameters, and checks every sample is identical.
//   node tests/bitmatch.mjs /path/to/fm-drum-machine
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), here = path.dirname(fileURLToPath(import.meta.url));
const ref = process.argv[2] || process.env.FMDM;
if (!ref) { console.log('bitmatch: no fm-drum-machine checkout given (argument or FMDM), skipped'); process.exit(0); }
const imp = (f) => import(pathToFileURL(path.join(ref, 'src/engine', f)).href);
const { Voice } = await imp('voice.js'), RP = await imp('params.js'), { INIT_KIT } = await imp('kits.js');
const M = require(path.join(here, '../src/fm/fm-voice.js'));
const SR = 44100, N = SR * 2;
let bad = 0;
// What the copy no longer has is left at its fm/dm default, where it does nothing: bursts 1, trim 0, pan 0, no crossfeed.
// What the synth voice adds is set to where it does nothing either: no sustain, no key track, FM decay x1, and the note
// is never released. fm/dm's tune becomes the pitch of the hit.
const GONE = new Set(['tune', 'pan', 'nBurst', 'nSpace', 'aDec2', 'trim', 'sEcho', 'sRev', 'sDist', 'sRing']);
const NEUTRAL = { aSus: 0, kTrack: 0, fmDecay: 1 }, ADDED = new Set(['aSus', 'aRel', 'kTrack', 'fmDecay', 'slide', 'accent']);
const cases = INIT_KIT.map((k, i) => [RP.VOICE_NAMES[i], k]);
cases.push(['everything on', { algo: 5, tune: 82.4, fmLvl: 0.7, fb: -0.6, fmEnd: 0.3, phase: 1, drift: 0.4, fmNoise: 0.5, hum: 0.8, rB: 2, lB: 0.8, aB: 12, dB: 300, rC: 3.5, lC: 0.6, dC: 150, fxC: 1, rD: 0.5, lD: 0.9, dD: 800,
  pAmt: 14, pDec: 80, clk: 0.4, clkType: 2, clkDec: 5, nLvl: 0.4, nType: 1, nCut: 2500, nRes: 0.6, nAtk: 20, nDec: 400, fType: 1, fCut: 900, fRes: 0.7, fDrive: 0.5, fEnv: 0.6, fEnvDec: 250,
  aAtk: 4, aHold: 30, aDec: 900, aCurve: 0.3, bits: 9, srDiv: 3, lShape: 4, lRate: 9, lDepth: 0.5, lDest: 3, lDest2: 7, lRetrig: 0, vLvl: 0.8, vPitch: 0.5, vFm: 0.6, vFilt: 0.7 }]);
for (const [name, kit] of cases) {
  const a = Float32Array.from(RP.defaultVoice()), vb = new M.FmVoice(SR, 7), b = vb.p;
  // start both from fm/dm's defaults (the synth's own defaults are a bass sound), then the kit voice on top
  for (const p of M.FM_PARAMS) if (!ADDED.has(p.id)) b[p.i] = a[RP.P[p.id]];
  for (const id in NEUTRAL) vb.setParam(id, NEUTRAL[id]);
  for (const id in kit) { a[RP.P[id]] = kit[id]; if (!GONE.has(id)) vb.setParam(id, kit[id]); }
  a[RP.P.pan] = 0;
  const va = new Voice(SR, 7), tune = a[RP.P.tune];
  let diff = 0, peak = 0;
  // three hits: a full one, a soft one that lands on the tail (the retrigger fade), a late one
  const hits = { 0: 1, [Math.round(SR * 0.21)]: 0.45, [Math.round(SR * 1.3)]: 0.8 };
  vb.gate = true;
  for (let i = 0; i < N; i++) {
    if (i in hits) { va.trigger(a, 0, hits[i], 0); vb.hit(tune, hits[i]); }
    va.process(a, 0); vb.tick();
    if (!Object.is(Math.fround(va.mono), Math.fround(vb.mono))) diff++;
    peak = Math.max(peak, Math.abs(va.mono));
  }
  const ok = diff === 0 && peak > 0.01;
  if (!ok) bad++;
  console.log(`${ok ? 'same' : 'DIFF'}  ${name.padEnd(14)} peak ${peak.toFixed(3)}${diff ? `  ${diff} samples differ` : ''}`);
}
if (bad) { console.log('\nThe FM voice no longer matches fm/dm sample for sample.'); process.exit(1); }
