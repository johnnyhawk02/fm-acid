// Renders a scenario (argv[3], default scenario.json next to it) with the web app's JS engine and writes raw float32 stereo to argv[2]
const fs = require('fs'), path = require('path');
const M = require(path.join(__dirname, '../tb303-model.js'));
const S = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, 'scenario.json'), 'utf8'));
const e = new M.TB303Engine(S.fs);
e.v.rng = S.seed | 0;
e.message({ type: 'bpm', value: S.bpm });
e.message({ type: 'groove', shuffle: S.groove.shuffle, gate: S.groove.gate });
e.message({ type: 'pattern', value: S.pattern.map(([code, accent, slide, gate]) => ({ code, accent: !!accent, slide: !!slide, gate: !!gate })) });
const N = Math.round(S.fs * S.seconds), L = new Float32Array(N), R = new Float32Array(N);
const ev = S.events.slice(); let started = false;
for (let i = 0; i < N; i += S.block) {
  while (ev.length && ev[0].at * S.fs <= i) {
    const x = ev.shift();
    for (const k in x.knobs || {}) e.message({ type: 'knob', name: k, value: x.knobs[k] });
    for (const k in x.parts || {}) e.message({ type: 'component', name: k, value: x.parts[k] });
    for (const k in x.fx || {}) e.message({ type: 'fx', name: k, value: x.fx[k] });
    if (x.tune) e.message({ type: 'tune', value: x.tune });
    if (x.wave) e.message({ type: 'wave', value: x.wave });
    if ('seq' in x) e.message({ type: 'seq', value: !!x.seq });
    for (const [note, vel] of x.notes || []) e.message({ type: 'note', on: vel > 0, note, vel });
  }
  if (!started) { e.message({ type: 'play', value: true }); started = true; }
  const n = Math.min(S.block, N - i);
  const l = L.subarray(i, i + n), r = R.subarray(i, i + n);
  e.render(l, r);
}
const out = new Float32Array(2 * N); for (let i = 0; i < N; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
fs.writeFileSync(process.argv[2], Buffer.from(out.buffer));
