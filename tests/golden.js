// Sound lock for the web engine (src/synth.js: the FM voice and the effects). Renders each scenario with tests/render.js and checks the
// output is bit-for-bit what tests/golden.json records, so a refactor can prove it changed nothing you can hear.
//   node tests/golden.js           check (exit 1 on any difference)
//   node tests/golden.js --update  record the current renders: do this, and commit golden.json, only when a
//                                  change to the sound is intended
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), file = path.join(__dirname, 'golden.json');
const SCENARIOS = ['tests/scenario-default.json', 'tests/scenario-factory.json'];
const update = process.argv.includes('--update');
const want = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const got = {};
let bad = 0;
for (const sc of SCENARIOS) {
  const out = path.join(os.tmpdir(), `golden-${process.pid}-${path.basename(sc, '.json')}.f32`);
  execFileSync(process.execPath, [path.join(root, 'tests/render.js'), out, path.join(root, sc)]);
  const buf = fs.readFileSync(out); fs.unlinkSync(out);
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  let sp = 0; for (const x of f) sp += x * x;
  got[sc] = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), rmsDb: +(10 * Math.log10(sp / f.length)).toFixed(2) };
  const ok = want[sc]?.sha256 === got[sc].sha256;
  if (!ok) bad++;
  console.log(`${ok ? 'same' : update ? 'new ' : 'DIFF'}  ${sc}  rms ${got[sc].rmsDb} dBFS${!ok && want[sc] ? ` (was ${want[sc].rmsDb})` : ''}`);
}
if (update) { fs.writeFileSync(file, JSON.stringify(got, null, 2) + '\n'); console.log('wrote tests/golden.json'); }
else if (bad) {
  console.log('\nThe engine no longer renders bit-for-bit what tests/golden.json records.');
  console.log('A refactor must not change the sound: find what moved. If the change is meant, run node tests/golden.js --update and commit tests/golden.json.');
  process.exit(1);
}
