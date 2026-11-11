// Renders a scenario (argv[3]) with the web app's engine (src/synth.js) and writes raw float32 stereo to argv[2].
// A scenario has fs, seconds, block, seed, bpm, then either a pattern and groove of its own or "preset": the name of a
// factory preset (factory-presets.json) whose sound, effects and pattern it plays; "events" then change things as it runs:
// { at (seconds), knobs, fm (FM voice parameters in real units), fx, tune, seq, notes: [[midiNote, velocity]...] }.
const fs = require('fs'), path = require('path');
const M = require(path.join(__dirname, '../src/synth.js'));
const S = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const e = new M.SynthEngine(S.fs, undefined, S.seed | 0);
const ev = (S.events || []).slice();
let pattern = S.pattern && S.pattern.map(([code, accent, slide, gate]) => ({ code, accent: !!accent, slide: !!slide, gate: !!gate })), groove = S.groove || { shuffle: 0, gate: 0.5 };
if (S.preset) {
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, '../factory-presets.json'), 'utf8'))[S.preset];
  if (!P) throw new Error('no factory preset called ' + S.preset);
  const slot = P.banks['A' + (P.sel.n + 1)];
  pattern = slot.pattern; groove = { shuffle: slot.shuffle, gate: slot.gate };
  ev.unshift({ at: 0, knobs: P.sound.knobs, fm: P.sound.fm, fx: P.sound.fx });
}
e.message({ type: 'bpm', value: S.bpm });
e.message({ type: 'groove', shuffle: groove.shuffle, gate: groove.gate });
e.message({ type: 'pattern', value: pattern });
const N = Math.round(S.fs * S.seconds), L = new Float32Array(N), R = new Float32Array(N);
let started = false;
for (let i = 0; i < N; i += S.block) {
  while (ev.length && ev[0].at * S.fs <= i) {
    const x = ev.shift();
    for (const k in x.knobs || {}) e.message({ type: 'knob', name: k, value: x.knobs[k] });
    for (const k in x.fm || {}) e.message({ type: 'param', name: k, value: x.fm[k] });
    for (const k in x.fx || {}) e.message({ type: 'fx', name: k, value: x.fx[k] });
    if (x.tune) e.message({ type: 'tune', value: x.tune });
    if ('seq' in x) e.message({ type: 'seq', value: !!x.seq });
    for (const [note, vel] of x.notes || []) e.message({ type: 'note', on: vel > 0, note, vel });
  }
  if (!started) { e.message({ type: 'play', value: true }); started = true; }
  const n = Math.min(S.block, N - i);
  e.render(L.subarray(i, i + n), R.subarray(i, i + n));
}
const out = new Float32Array(2 * N); for (let i = 0; i < N; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
fs.writeFileSync(process.argv[2], Buffer.from(out.buffer));
