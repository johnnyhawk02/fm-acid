// Works out SYNTH_LEVEL (src/synth.js): the gain that puts the FM voice's default sound, playing the default pattern,
// at the RMS the 303 app's default sound had at its VCA output, the point its drive pedals, folder and ducker are
// calibrated to. Needs a checkout of johnnyhawk02/tb303-circuit-model:
//   node tools/level.js /path/to/tb303-circuit-model
const fs = require('fs'), path = require('path'), os = require('os');
const ref = process.argv[2] || process.env.TB303;
if (!ref) { console.log('usage: node tools/level.js /path/to/tb303-circuit-model'); process.exit(1); }
// the 303 voice with a tap where its signal leaves the VCA and volume pot, ahead of the folder and the drive slot
const src = fs.readFileSync(path.join(ref, 'tb303-model.js'), 'utf8'), line = 'let o = this.hp38 * this.vol * OUT_TRIM + nX * 4.0;';
if (!src.includes(line)) throw new Error('the 303 voice has changed: its VCA output line was not found');
const tmp = path.join(os.tmpdir(), `tb303-tap-${process.pid}.js`);
fs.writeFileSync(tmp, src.replace(line, line + ' if (this.tap) this.tap(o);'));
const R = require(tmp); fs.unlinkSync(tmp);
const M = require('../src/synth.js');
const FS = 48000, BARS = 8, BPM = 128;
// both apps' first-load pattern and the 303 app's first-load dials (its state.js)
const PATTERN = [[21,1,0,1],[21,0,0,1],[33,0,1,1],[31,0,0,1],[21,1,0,1],[0,0,0,0],[24,0,1,1],[26,0,0,1],[21,0,0,1],[33,1,0,1],[28,0,1,1],[24,0,0,1],[21,1,1,1],[19,0,0,1],[0,0,0,0],[36,1,0,1]]
  .map(([code, accent, slide, gate]) => ({ code: code || 21, accent: !!accent, slide: !!slide, gate: !!gate }));
const KNOBS_303 = { tuning: 0.5, cutoff: 0.3, resonance: 0.82, envmod: 0.62, decay: 0.3, accent: 0.75, volume: 0.85 };
function run(e, tapOn) {
  let s = 0, n = 0, pk = 0; tapOn((o) => { s += o * o; n++; if (Math.abs(o) > pk) pk = Math.abs(o); });
  e.message({ type: 'bpm', value: BPM }); e.message({ type: 'groove', shuffle: 0, gate: 0.5 }); e.message({ type: 'pattern', value: PATTERN }); e.message({ type: 'play', value: true });
  const N = Math.round(FS * 60 / BPM * 4 * BARS), L = new Float32Array(128);
  for (let i = 0; i < N; i += 128) e.render(L);
  return { rms: Math.sqrt(s / n), pk };
}
const a = new R.TB303Engine(FS); a.v.rng = 1; for (const k in KNOBS_303) a.v.setKnob(k, KNOBS_303[k]);
const ra = run(a, (f) => { a.v.tap = f; });
const b = new M.SynthEngine(FS); b.v.fm.rng = new M.FmRng(1);
const tick = b.v.fm.tick.bind(b.v.fm); let tap;
b.v.fm.tick = () => { tick(); tap(b.v.fm.mono * b.v.vol / M.SYNTH_LEVEL); };
const rb = run(b, (f) => { tap = f; });
const db = (x) => (20 * Math.log10(x)).toFixed(1) + ' dB';
console.log(`303 default sound at the VCA output:  rms ${ra.rms.toFixed(4)} (${db(ra.rms)})  peak ${ra.pk.toFixed(3)}`);
console.log(`FM default sound at SYNTH_LEVEL 1:    rms ${rb.rms.toFixed(4)} (${db(rb.rms)})  peak ${rb.pk.toFixed(3)}`);
console.log(`SYNTH_LEVEL = ${(ra.rms / rb.rms).toFixed(3)}  (now ${M.SYNTH_LEVEL}; FM peak would be ${(rb.pk * ra.rms / rb.rms).toFixed(3)})`);
