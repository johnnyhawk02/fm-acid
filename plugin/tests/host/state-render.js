// Renders a plug-in state file (the JSON the plug-in saves) with the web app's JS engine the way the plug-in starts
// an engine from it, playing from the top at a fixed tempo, for comparing with tbhost's render.
//   node plugin/tests/host/state-render.js <state.json> <seconds> <out.f32> [bpm]
const fs = require('fs'), path = require('path');
const M = require(path.join(__dirname, '../../../tb303-model.js'));
const [file, secs, out, bpm = 128] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(file, 'utf8')), e = new M.TB303Engine(48000), v = e.v;
const by = (pre) => st.engine.filter(m => (m.type + ':').startsWith(pre) || m.type === pre.replace(':', ''));
const order = [['knob', m => v.setKnob(m.name, m.value)], ['component', m => v.setComponent(m.name, m.value)], ['wave', m => e.message(m)], ['tune', m => e.message(m)],
  ['pattern', m => e.message(m)], ['groove', m => e.message(m)], ['fx', m => e.message(m)], ['declick', m => e.message(m)]];
// the plug-in replays them sorted by key (k:name, c:name, fx:name), knobs and parts set at once
const key = (m) => m.type === 'knob' ? 'k:' + m.name : m.type === 'component' ? 'c:' + m.name : m.type === 'fx' ? 'fx:' + m.name : m.type;
const msgs = st.engine.slice().sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
for (const [t, f] of order) for (const m of msgs) if (m.type === t) f(m);
e.message({ type: 'bpm', value: +bpm }); e.message({ type: 'play', value: true });
const N = Math.round(48000 * secs), L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i += 512) e.render(L.subarray(i, Math.min(N, i + 512)), R.subarray(i, Math.min(N, i + 512)));
const o = new Float32Array(2 * N); for (let i = 0; i < N; i++) { o[2 * i] = L[i]; o[2 * i + 1] = R[i]; }
fs.writeFileSync(out, Buffer.from(o.buffer));
