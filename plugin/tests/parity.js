// Checks the plug-in's C++ engine renders what the web app's JS engine renders: both play each scenario in tests/
// (the golden sound-lock scenarios) and the outputs are compared sample by sample.
//   node plugin/tests/parity.js [path/to/render-binary]   (default: builds plugin/tests/render with c++)
// Exit 1 if any scenario differs by more than the limit below.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '../..');
const LIMIT_DB = -90; // worst sample error, dB relative to full scale
let bin = process.argv[2];
if (!bin) {
  bin = path.join(os.tmpdir(), 'tb303-render-' + process.pid);
  execFileSync(process.env.CXX || 'c++', ['-std=c++17', '-O2', '-ffp-contract=off', '-o', bin, path.join(__dirname, 'render.cpp')], { stdio: 'inherit' });
}
const read = (f) => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
let bad = 0;
for (const sc of ['tests/scenario.json', 'tests/scenario-44k.json', 'tests/scenario-midi.json']) {
  const S = JSON.parse(fs.readFileSync(path.join(root, sc), 'utf8'));
  // the same event order tests/render.js uses: at each block start, every due event's knobs, parts, fx, tune, wave, seq, notes
  const lines = [`fs ${S.fs}`, `seconds ${S.seconds}`, `block ${S.block}`, `seed ${S.seed | 0 >>> 0}`, `bpm ${S.bpm}`, `groove ${S.groove.shuffle} ${S.groove.gate}`];
  for (const [code, accent, slide, gate] of S.pattern) lines.push(`step ${code} ${accent ? 1 : 0} ${slide ? 1 : 0} ${gate ? 1 : 0}`);
  for (const x of S.events) {
    const at = Math.ceil(x.at * S.fs / S.block) * S.block; // first block start with at * fs <= i
    for (const k in x.knobs || {}) lines.push(`ev ${at} knob ${k} ${x.knobs[k]}`);
    for (const k in x.parts || {}) lines.push(`ev ${at} part ${k} ${x.parts[k]}`);
    for (const k in x.fx || {}) lines.push(`ev ${at} fx ${k} ${x.fx[k] ? 1 : 0}`);
    if (x.tune) lines.push(`ev ${at} tune ${x.tune.join(' ')}`);
    if (x.wave) lines.push(`ev ${at} wave ${x.wave}`);
    if ('seq' in x) lines.push(`ev ${at} seq ${x.seq ? 1 : 0}`);
    for (const [note, vel] of x.notes || []) lines.push(`ev ${at} note ${note} ${vel}`);
  }
  const txt = path.join(os.tmpdir(), `parity-${process.pid}.txt`), a = txt + '.js.f32', b = txt + '.cpp.f32';
  fs.writeFileSync(txt, lines.join('\n') + '\n');
  execFileSync(process.execPath, [path.join(root, 'tests/render.js'), a, path.join(root, sc)]);
  execFileSync(bin, [txt, b]);
  const A = read(a), B = read(b);
  let maxErr = 0, at = -1, same = 0, sig = 0, err = 0;
  for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); if (d > maxErr) { maxErr = d; at = i; } if (A[i] === B[i]) same++; sig += A[i] * A[i]; err += d * d; }
  const db = (x) => x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf';
  const ok = A.length === B.length && maxErr <= Math.pow(10, LIMIT_DB / 20);
  if (!ok) bad++;
  console.log(`${ok ? 'same' : 'DIFF'}  ${sc}  ${(100 * same / A.length).toFixed(2)}% identical samples, worst ${db(maxErr)} dBFS${at >= 0 ? ` at ${(at / 2 / S.fs).toFixed(3)} s` : ''}, error ${db(Math.sqrt(err / A.length))} dBFS rms vs signal ${db(Math.sqrt(sig / A.length))}`);
  for (const f of [txt, a, b]) fs.unlinkSync(f);
}
if (bad) { console.log(`\nThe C++ engine no longer matches the web engine (limit ${LIMIT_DB} dBFS). Port the change in tb303-model.js to plugin/engine/.`); process.exit(1); }
