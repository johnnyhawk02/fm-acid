// Quick checks of the engine (src/synth.js), and demo.wav: the default sound playing the default pattern.
//   node test.js
const fs = require('fs'), path = require('path');
const M = require('./src/synth.js');
const SR = 48000;
// the app's default pattern (EXAMPLE in src/js/app/state.js)
const src = fs.readFileSync(path.join(__dirname, 'src/js/app/state.js'), 'utf8');
const EXAMPLE = eval(src.match(/const EXAMPLE = (\[[\s\S]*?\]\.map\([\s\S]*?\)\));/)[1]);
function render(seconds, setup, pattern = EXAMPLE, groove = { shuffle: 0, gate: 0.5 }) {
  const e = new M.SynthEngine(SR, undefined, 12345);
  e.message({ type: 'bpm', value: 128 }); e.message({ type: 'groove', ...groove }); e.message({ type: 'pattern', value: pattern });
  if (setup) setup(e);
  e.message({ type: 'play', value: true });
  const N = Math.round(SR * seconds), L = new Float32Array(N), R = new Float32Array(N);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i += 128) e.render(L.subarray(i, Math.min(N, i + 128)), R.subarray(i, Math.min(N, i + 128)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let peak = 0, sq = 0, bad = 0;
  for (let i = 0; i < N; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (!isFinite(a) || !isFinite(b)) bad++; if (a > peak) peak = a; if (b > peak) peak = b; sq += L[i] * L[i] + R[i] * R[i]; }
  return { L, R, peak, rmsDb: 10 * Math.log10(sq / (2 * N) + 1e-30), bad, speed: seconds * 1000 / ms };
}
let fail = 0;
const check = (ok, text) => { console.log((ok ? 'ok    ' : 'FAIL  ') + text); if (!ok) fail++; };

// 1. pitch: the pattern's A (code 33) is 110 Hz with Tuning in the middle
{
  const v = new M.FmVoice(SR * 2, 1); v.setParam('fType', 0); v.setParam('lB', 0); v.noteOn(33, false, false);
  const buf = new Float32Array(SR * 2); v.process(buf, 0, buf.length);
  let zc = 0; for (let i = SR; i < buf.length; i++) if (buf[i - 1] < 0 && buf[i] >= 0) zc++;
  check(Math.abs(zc / 0.5 - 110) <= 2, `code 33 plays ${(zc / 0.5).toFixed(0)} Hz (110)`);
}
// 2. the default sound on the default pattern: four bars, written to demo.wav
{
  const r = render(60 / 128 * 16, null);
  check(!r.bad && r.peak > 0.05 && r.peak <= 1, `default sound: peak ${r.peak.toFixed(3)}, ${r.rmsDb.toFixed(1)} dBFS rms, ${r.speed.toFixed(0)}× real time`);
  const N = r.L.length, pcm = Buffer.alloc(44 + N * 4);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
  const s16 = (x) => Math.max(-32767, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < N; i++) { pcm.writeInt16LE(s16(r.L[i]), 44 + i * 4); pcm.writeInt16LE(s16(r.R[i]), 46 + i * 4); }
  fs.writeFileSync(path.join(__dirname, 'demo.wav'), pcm);
  console.log('      wrote demo.wav');
}
// 3. every factory preset plays its own pattern: no NaN, not silent, not clipping hard
{
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'factory-presets.json'), 'utf8'));
  for (const [name, P] of Object.entries(F)) {
    const slot = P.banks['A' + (P.sel.n + 1)];
    const r = render(4, (e) => {
      for (const k in P.sound.knobs) e.message({ type: 'knob', name: k, value: P.sound.knobs[k] });
      for (const k in P.sound.fm) e.message({ type: 'param', name: k, value: P.sound.fm[k] });
      for (const k in P.sound.fx) e.message({ type: 'fx', name: k, value: P.sound.fx[k] });
    }, slot.pattern, { shuffle: slot.shuffle, gate: slot.gate });
    check(!r.bad && r.rmsDb > -40 && r.peak < 1.5, `factory ${name.padEnd(28)} peak ${r.peak.toFixed(2)}  ${r.rmsDb.toFixed(1)} dBFS rms`);
  }
}
// 4. every FM parameter at both ends of its range: nothing blows up
{
  let bad = 0;
  for (const p of M.FM_PARAMS) for (const val of [p.min, p.max]) { const r = render(0.75, (e) => e.message({ type: 'param', name: p.id, value: val })); if (r.bad || r.peak > 4) { bad++; console.log('      ', p.id, val, 'peak', r.peak, 'nan', r.bad); } }
  check(!bad, `every FM parameter at its lowest and highest: ${bad ? bad + ' misbehave' : 'all finite'}`);
}
process.exit(fail ? 1 : 0);
