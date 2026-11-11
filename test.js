const { TB303Voice, dacVoltage, VT } = require('./tb303-model.js');
const fs=require('fs');
const SR=44100;
// 1. DAC
console.log('DAC code33', dacVoltage(33,5.333,100e3,200e3).toFixed(4), 'code24', dacVoltage(24,5.333,100e3,200e3).toFixed(4));
// 2. pitch: count zero crossings of raw saw with filter wide open
let v=new TB303Voice(SR); v.setKnob('cutoff',1); v.setKnob('envmod',0); v.setKnob('resonance',0);
v.noteOn(33,false,false);
const N=SR*2, buf=new Float32Array(N); v.process(buf);
let zc=0; for(let i=SR;i<N;i++) if(buf[i-1]<0&&buf[i]>=0) zc++; console.log('A key Hz ~', zc);
// 3. cutoff range
const w=v.wCut*v.c.V_CUT; console.log('Q10 base span (mV)', (w*1000).toFixed(1), 'res Hz at min', v.vcfResonantHz(0).toFixed(0), 'max', v.vcfResonantHz(w).toFixed(0), 'max+env', v.vcfResonantHz(w+v.wEnv*5).toFixed(0));
// 4. decay times to 10%
for(const d of [0,1]){ v=new TB303Voice(SR); v.setKnob('decay',d); console.log('decay knob',d,'T10% (s)', (2.3026*(v.c.R138+v.c.VR6*d)*v.c.C62).toFixed(3)); }
// 5. render pattern
v=new TB303Voice(SR);
v.setKnob('cutoff',0.25); v.setKnob('resonance',0.85); v.setKnob('envmod',0.7); v.setKnob('decay',0.25);
const pat=[[21,1,0],[33,0,0],[21,0,1],[24,0,0],[36,1,0],[21,0,0],[28,0,1],[33,0,0],[21,1,0],[19,0,0],[31,0,1],[33,1,0],[21,0,0],[45,0,0],[33,0,1],[24,1,0]];
const step=Math.round(SR*60/130/4), bars=4, out=new Float32Array(step*16*bars);
let pos=0;
for(let b=0;b<bars;b++){ if(b==2) v.waveform='square';
 for(let s=0;s<16;s++){const [n,a,sl]=pat[s]; const prevSlide=s>0?pat[s-1][2]:pat[15][2];
  v.noteOn(n,a,prevSlide); const g=Math.round(step*(sl?1:0.5));
  v.process(out,pos,pos+g); if(!sl) v.noteOff(); v.process(out,pos+g,pos+step); pos+=step;}}
let mx=0,nan=0; for(const x of out){ if(!isFinite(x)) nan++; mx=Math.max(mx,Math.abs(x)); }
console.log('peak',mx.toFixed(3),'nan',nan);
// speed
const t0=Date.now(); const tb=new Float32Array(SR*5); v.process(tb); console.log('realtime factor', (5000/(Date.now()-t0)).toFixed(1),'x');
// wav
const pcm=Buffer.alloc(44+out.length*2); pcm.write('RIFF',0);pcm.writeUInt32LE(36+out.length*2,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(SR,24);pcm.writeUInt32LE(SR*2,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(out.length*2,40);
for(let i=0;i<out.length;i++) pcm.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(out[i]/Math.max(mx,1e-9)*0.9*32767))),44+i*2);
fs.writeFileSync('demo.wav',pcm);
// 6. Lexicon 224: measured decay should follow the Mid decay setting on every reverb program
{
  const { Lexicon224, LEX_PROGRAMS, lexParams, COMPONENTS } = require('./tb303-model.js');
  const c = {}; for (const k in COMPONENTS) c[k] = COMPONENTS[k].v;
  const knobs = new TB303Voice(SR).knobs;
  for (let pr = 0; pr < 8; pr++) {
    const k = { ...knobs, lexprog: pr / 8, lexdepth: 1 }, L = new Lexicon224(SR); L.derive(c, k);
    const w = SR / 20, en = []; let s = 0, bad = 0;
    for (let i = 0; i < SR * 6; i++) { L.run(i < 200 ? 0.8 * Math.sin(i * 0.3) : 0); const y = L.L * L.L + L.R * L.R; if (!isFinite(y)) bad++; s += y; if ((i + 1) % w === 0) { en.push(s); s = 0; } }
    const mx = Math.max(...en), im = en.indexOf(mx), at = (db) => en.findIndex((e, i) => i >= im && 10 * Math.log10(e / mx) < db) * 0.05;
    const m = L.memoryUse();
    console.log('224', LEX_PROGRAMS[pr].short.padEnd(13), 'Mid', lexParams(k).mid.toFixed(2), 's  measured RT60', (3 * (at(-25) - at(-5))).toFixed(2), 's  memory', m.words, '/', m.of, bad ? 'NaN!' : '');
  }
}
// 7. key track: KT 0 switches R_KT out (stock weights); full pot is about 300% of 1 V/oct with the 36K R_KT
{
  const a = new TB303Voice(SR), b = new TB303Voice(SR); b.setComponent('KT', 1);
  const track = b.wKt / (VT * Math.LN2);
  console.log('key track: KT 0 wKt', a.wKt, 'stock wCut', a.wCut === new TB303Voice(SR).wCut, ' KT full tracking', (track * 100).toFixed(1) + '% of 1 V/oct', Math.abs(track - 3.06) < 0.05 ? 'ok' : 'FAIL');
}
