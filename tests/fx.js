// The effects must be the 303 app's, sample for sample. Pushes one fixed signal through FxChain (src/fx/fx.js) and
// through the 303 app's own code (tb303-model.js from a checkout of johnnyhawk02/tb303-circuit-model: pass its path, or
// set TB303), for every effect and routing, and checks the outputs are identical.
//   node tests/fx.js /path/to/tb303-circuit-model
// In the 303 app the effects sit inside its voice, so the reference voice's circuit is swapped for the test signal: its
// _tick is replaced by the same few lines it ends with (the folder and drive slot in either order, the output stage),
// calling the 303's own units. Everything after that (decimator, flanger, returns, ducker) is the 303's process().
const path = require('path');
const ref = process.argv[2] || process.env.TB303;
if (!ref) { console.log('fx: no tb303-circuit-model checkout given (argument or TB303), skipped'); process.exit(0); }
const R = require(path.join(path.resolve(ref), 'tb303-model.js')), M = require(path.join(__dirname, '../src/fx/fx.js'));
const FS = 48000, N = Math.round(FS * 1.2);
// the test signal, at 2x: a bass line of decaying notes with a bright edge, at about the 303's VCA level, then silence
const sig = new Float64Array(2 * N);
{ let s = 12345; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
  for (let i = 0; i < 2 * N; i++) {
    const t = i / (2 * FS), note = Math.floor(t / 0.12), tn = t - note * 0.12, f = [55, 110, 82.4, 164.8, 73.4][note % 5];
    const ph = (t * f) % 1, e = t < 0.85 ? Math.exp(-tn * 18) : 0;
    sig[i] = e * (0.45 * (2 * ph - 1) + 0.12 * Math.sin(2 * Math.PI * 9 * f * t) + 0.01 * rnd());
  } }
const CASES = [
  ['dry', {}, {}],
  ['rodent', { rat: 1 }, { dist: 0.7, filter: 0.3, ratvol: 0.6 }],
  ['dist one', { rat: 1 }, { drvtype: 0.5, dsdist: 0.8, dstone: 0.3, dslevel: 0.6 }],
  ['green 808', { rat: 1 }, { drvtype: 1, tsdrive: 0.9, tstone: 0.7, tslevel: 0.6 }],
  ['folder', { fold: 1 }, { fldtimbre: 0.8, fldsym: 0.3, fldlevel: 0.6 }],
  ['fold > drive', { fold: 1, rat: 1 }, { fldtimbre: 0.6, dist: 0.6 }],
  ['drive > fold', { fold: 1, rat: 1 }, { fldtimbre: 0.6, dist: 0.6, fxorder: 1 }],
  ['flanger', { flg: 1 }, { flgman: 0.3, flgdep: 0.7, flgrate: 0.6, flgres: 0.8 }],
  ['chorus', { flg: 1 }, { flgmode: 1, flgdep: 0.8, flgrate: 0.4 }],
  ['delay ping-pong', { dly: 1 }, { dlytime: 0.4, dlyfb: 0.6, dlylo: 0.4, dlyhi: 0.5, dlymix: 0.6 }],
  ['delay mono', { dly: 1 }, { dlypp: 0, dlytime: 0.2, dlyfb: 0.5, dlymix: 0.6 }],
  ...[0, 0.125, 0.5, 1].map((p) => [`224 program ${p}`, { lex: 1 }, { lexprog: p, lexmid: 0.2, lexdepth: 0.8, lexmix: 0.7 }]),
  ['224 parts', { lex: 1 }, { lexprog: 0.25 }, { LEX_FS: 32000, LEX_BITS: 10 }],
  ...[0, 0.5, 1].map((p) => [`plate ${p}`, { lex: 1 }, { revtype: 1 / 3, plateprog: p, platedecay: 0.5, platemod: 0.8, platemix: 0.7 }]),
  ...[0, 2 / 3, 1].map((p) => [`spring ${p.toFixed(2)}`, { lex: 1 }, { revtype: 2 / 3, sprprog: p, sprtension: 0.7, sprdwell: 0.7, sprmix: 0.7 }]),
  ...[0, 0.6, 1].map((p) => [`convolution ${p}`, { lex: 1 }, { revtype: 1, cnvprog: p, cnvdecay: 0.6, cnvpre: 0.4, cnvmix: 0.7 }]),
  ['ducker deep', { lex: 1, dly: 1 }, { cmpamt: 0.9, cmprel: 0.15 }],
  ['ducker off', { lex: 1, dly: 1 }, { cmpamt: 0 }],
  ['delay > reverb', { lex: 1, dly: 1 }, { fxret: 0.5 }],
  ['reverb > delay', { lex: 1, dly: 1 }, { fxret: 1, revtype: 1 / 3 }],
  ['everything', { rat: 1, fold: 1, flg: 1, dly: 1, lex: 1 }, { drvtype: 0.5, fxorder: 1, fxret: 0.5, revtype: 2 / 3 }],
];
let bad = 0;
for (const [name, fx, knobs, parts] of CASES) {
  const a = new R.TB303Voice(FS), b = new M.FxChain(FS);
  for (const u of [a, b]) { for (const k in fx) u.setFx(k, fx[k]); for (const k in knobs) u.setKnob(k, knobs[k]); for (const k in parts || {}) u.setComponent(k, parts[k]); }
  let ia = 0;
  a._tick = function () {
    let o = sig[ia++];
    if (this.fxSwap) {
      if (this.fx.rat) o = this.drvT === 1 ? this.ds.run(o) : this.drvT === 2 ? this.ts.run(o) : this._rat(o);
      if (this.fx.fold) o = this.b259.run(o);
    } else {
      if (this.fx.fold) o = this.b259.run(o);
      if (this.fx.rat) o = this.drvT === 1 ? this.ds.run(o) : this.drvT === 2 ? this.ts.run(o) : this._rat(o);
    }
    return 0.95 * Math.tanh(o / 0.95);
  };
  const aL = new Float32Array(N), aR = new Float32Array(N), bL = new Float32Array(N), bR = new Float32Array(N);
  const BLOCK = 128, wet = b.fx.lex || b.fx.dly || b.fx.flg;
  for (let i = 0, ib = 0; i < N; i += BLOCK) {
    const e = Math.min(N, i + BLOCK);
    a.process(aL, i, e, aR);
    b.flush();
    for (let n = i; n < e; n++) {
      let y = 0;
      for (let o = 0; o < 2; o++) y = b.decimate(b.drive(sig[ib++]));
      if (wet) b.out(y, bL, bR, n); else bL[n] = bR[n] = y;
    }
  }
  let diff = 0, pk = 0, side = 0;
  for (let i = 0; i < N; i++) { if (!Object.is(aL[i], bL[i]) || !Object.is(aR[i], bR[i])) diff++; pk = Math.max(pk, Math.abs(aL[i])); side = Math.max(side, Math.abs(aL[i] - aR[i])); }
  const ok = diff === 0 && pk > 0.01 && isFinite(pk);
  if (!ok) bad++;
  console.log(`${ok ? 'same' : 'DIFF'}  ${name.padEnd(18)} peak ${pk.toFixed(3)}  stereo ${side.toFixed(3)}${diff ? `  ${diff} samples differ` : ''}`);
}
if (bad) { console.log('\nThe effects no longer match the 303 app sample for sample.'); process.exit(1); }
