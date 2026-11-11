/*
 * The synth: the FM voice into the effects, and the player around it
 * -------------------------------------------------------------------
 * SynthVoice is src/fm/fm-voice.js (an FM voice from fm/dm, MIT) feeding FxChain (src/fx/fx.js, the 303 Circuit Model
 * app's effects). ParamSlew, DeClick and SynthEngine are that app's (tb303-model.js: ParamSlew, DeClick, TB303Engine),
 * unchanged apart from the names and the FM voice's parameters.
 *
 * In a page and in the AudioWorklet the three scripts are loaded one after another into one scope; in Node this file
 * requires the other two. No DOM use.
 */
if (typeof module !== 'undefined' && module.exports && typeof FmVoice === 'undefined') {
  Object.assign(globalThis, require('./fm/fm-voice.js'), require('./fx/fx.js'));
}

// The effects are calibrated to the 303's signal at its VCA output (the drive pedals' levels, the folder's peak
// follower, the ducker's thresholds). SYNTH_LEVEL scales the FM voice so its default sound playing the default pattern
// arrives there at the same RMS as the 303 app's default sound did (tools/level.js measures both).
const SYNTH_LEVEL = 0.845;

// FM parameters that switch at once instead of gliding (see ParamSlew)
const FM_STEPPED = new Set(['algo', 'fType', 'lShape', 'lDest', 'lDest2', 'clkType', 'nType', 'fxA', 'fxB', 'fxC', 'fxD', 'phase', 'lRetrig']);

class SynthVoice {
  constructor(sampleRate, components, seed) {
    this.fsOut = sampleRate;
    this.os = 2;
    this.fs = sampleRate * this.os;
    // the FM voice runs at 2x the host rate, as the 303 circuit did, so the folder and the pedals see the same
    // oversampled signal and the decimator stays where it was
    this.fm = new FmVoice(this.fs, seed === undefined ? 0x9e3779b9 ^ ((Math.random() * 0x7fffffff) | 0) : seed);
    this.chain = new FxChain(sampleRate, components);
    // one set of dials (0..1): the effects' own, plus Tuning and Volume from the front panel
    this.knobs = this.chain.knobs; this.knobs.tuning = 0.5; this.knobs.volume = 0.85;
    this.fx = this.chain.fx; this.c = this.chain.c;
    this._derive();
  }
  get gate() { return this.fm.gate; }
  get bpm() { return this.chain.bpm; } set bpm(v) { this.chain.bpm = v; }
  get dly() { return this.chain.dly; } get conv() { return this.chain.conv; }

  setComponent(name, value) { if (name in this.c) { this.c[name] = value; this._derive(); } }
  setFx(name, on) { this.chain.setFx(name, on); }
  setKnob(name, value) { if (name in this.knobs) { this.knobs[name] = value; this._derive(); } }
  setParam(id, value) { this.fm.setParam(id, value); }
  setTune(cents) { this.fm.setTune(cents); }

  _derive() {
    this.chain.derive();
    this.fm.setTuning((this.knobs.tuning - 0.5) * 24); // ±12 semitones
    this.vol = audioTaper(this.knobs.volume) * SYNTH_LEVEL;
  }

  noteOn(code, accent, slide) { this.fm.noteOn(code, accent, slide); }
  noteOff() { this.fm.noteOff(); }

  _fxOut(y, out, outR, n) { this.chain.out(y, out, outR, n); }

  // out is mono, or the left channel when outR is given
  process(out, start = 0, end = out.length, outR) {
    const fm = this.fm, ch = this.chain, vol = this.vol;
    ch.flush(); flushTiny(fm, 0); flushTiny(fm.filt, 0); flushTiny(fm.nfilt, 0);
    const fx = this.fx.lex || this.fx.dly || this.fx.flg;
    for (let n = start; n < end; n++) {
      let y = 0;
      for (let o = 0; o < this.os; o++) { fm.tick(); y = ch.decimate(ch.drive(fm.mono * vol)); }
      if (fx) ch.out(y, out, outR, n);
      else { out[n] = y; if (outR) outR[n] = y; }
    }
  }
}

// Dial changes glide to their new value (one-pole, ~15 ms) instead of jumping, so turning a control, MIDI CC steps or
// a preset load do not zipper the sound. It only decides what value the voice sees each 32-sample tick. Three kinds:
// 'k' a dial (0..1), 'c' a part of the effects, 'f' an FM voice parameter in real units (the ones with an exponential
// dial glide in log). Discrete controls switch at once.
class ParamSlew {
  constructor(voice, fs, tau = 0.015) { this.v = voice; this.fs = fs; this.tau = tau; this.t = new Map(); }
  static instant(kind, name) {
    if (kind === 'f') return FM_STEPPED.has(name);
    return name.endsWith('prog') || name === 'revtype' || name === 'drvtype' || name === 'fxorder' || name === 'fxret' || name === 'flgmode' || name.startsWith('LEX_');
  }
  _put(kind, name, value) { const v = this.v; if (kind === 'k') v.setKnob(name, value); else if (kind === 'c') v.setComponent(name, value); else v.setParam(name, value); }
  set(kind, name, value) {
    const v = this.v;
    if (ParamSlew.instant(kind, name) || !isFinite(value)) { this.t.delete(kind + name); this._put(kind, name, value); return; }
    const cur = kind === 'k' ? v.knobs[name] : kind === 'c' ? v.c[name] : v.fm.p[FM_P[name]];
    if (cur === undefined) return;
    const log = kind === 'c' ? value > 0 && cur > 0 : kind === 'f' && FM_PARAMS[FM_P[name]].curve === 'exp';
    this.t.set(kind + name, { kind, name, value, log });
  }
  get active() { return this.t.size > 0; }
  tick(n) {
    if (!this.t.size) return;
    const v = this.v, a = 1 - Math.exp(-n / (this.tau * this.fs));
    let derive = false;
    for (const [key, e] of this.t) {
      const obj = e.kind === 'k' ? v.knobs : e.kind === 'c' ? v.c : v.fm.p, at = e.kind === 'f' ? FM_P[e.name] : e.name, cur = obj[at];
      let nx = e.log ? Math.exp(Math.log(cur) + (Math.log(e.value) - Math.log(cur)) * a) : cur + (e.value - cur) * a;
      if (Math.abs(nx - e.value) <= 1e-4 * Math.max(1e-9, Math.abs(e.value)) || (!e.log && Math.abs(nx - e.value) < 1e-5)) { nx = e.value; this.t.delete(key); }
      obj[at] = nx; if (e.kind !== 'f') derive = true;
    }
    if (derive) v._derive();
  }
}

// De-click: an output stage after the voice. A retrigger can land on a ringing tail (the voice fades the old note
// over 64 samples itself, but the drive pedals and the folder sharpen what is left). The
// sequencer knows exactly when each retrigger happens, so the output is delayed by a few ms and the
// level eases to zero and back over `fadeMs` around each retrigger. Between retriggers the signal
// passes through untouched. Slides (no retrigger) are left alone. Note-offs are optional: the amp envelope
// has its own release there, so they are skipped unless `offs` is set.
class DeClick {
  constructor(voice, fs, { on = true, fadeMs = 1.5, lookMs = 3, offs = false } = {}) {
    this.v = voice; this.fs = fs; this.D = Math.max(1, Math.round(lookMs * 1e-3 * fs));
    this.bufL = new Float32Array(this.D); this.w = 0;
    this.t = 0; this.ev = []; this.offs = offs; this.on = on; this.setFade(fadeMs);
    const on0 = voice.noteOn.bind(voice), off0 = voice.noteOff.bind(voice);
    voice.noteOn = (code, accent, slide) => { if (!(voice.gate && slide)) this.mark(); on0(code, accent, slide); };
    voice.noteOff = () => { if (voice.gate && this.offs) this.mark(); off0(); };
  }
  setFade(ms) { this.F = Math.max(1, Math.min(this.D, Math.round(ms * 1e-3 * this.fs))); }
  setOn(on) { if (on === this.on) return; this.on = on; this.bufL.fill(0); this.ev.length = 0; }
  mark() { if (this.on) this.ev.push(this.t); }
  process(out, start = 0, end = out.length, outR) {
    const v = this.v;
    if (!this.on) { v.process(out, start, end, outR); this.t += end - start; return; }
    // run the voice dry and do the returns here, after the fade, so a retrigger never dips the reverb or delay tails
    const lex = v.fx.lex, dly = v.fx.dly, flg = v.fx.flg, fx = lex || dly || flg;
    v.fx.lex = v.fx.dly = v.fx.flg = false; v.process(out, start, end); v.fx.lex = lex; v.fx.dly = dly; v.fx.flg = flg;
    const D = this.D, F = this.F, L = this.bufL, ev = this.ev;
    for (let n = start; n < end; n++, this.t++) {
      let y = L[this.w]; L[this.w] = out[n]; this.w = this.w + 1 === D ? 0 : this.w + 1;
      // yl/yr belong to time t - D; ease the level around any retrigger within F of it
      const tt = this.t - D;
      while (ev.length && ev[0] <= tt - F) ev.shift();
      if (ev.length) {
        let g = 1;
        for (let i = 0; i < ev.length; i++) {
          const d = Math.abs(tt - ev[i]); if (d < F) { const s = 0.5 - 0.5 * Math.cos(Math.PI * d / F); if (s < g) g = s; }
        }
        y *= g;
      }
      if (fx) v._fxOut(y, out, outR, n);
      else { out[n] = y; if (outR) outR[n] = y; }
    }
  }
}

// The player around the voice: parameter slew, de-click, and the step sequencer that walks a pattern.
// The AudioWorklet and the main-thread fallback both run this, so they sound the same.
// Messages: knob, param (an FM voice parameter, real units), component, tune, fx, declick, pattern, transpose, bpm, groove (shuffle, gate length), play,
// seq (the step sequencer on or off) and note (a MIDI note, played straight on the voice while the sequencer is off).
class SynthEngine {
  constructor(fs, onStep = () => {}) {
    this.fs = fs; this.onStep = onStep;
    this.v = new SynthVoice(fs); this.slew = new ParamSlew(this.v, fs); this.dc = new DeClick(this.v, fs);
    this.playing = false; this.bpm = 128; this.pattern = []; this.shuffle = 0; this.gate = 0.5;
    this.transpose = 0; // semitones the pattern plays up (the root note from MIDI)
    this.step = -1; this.ctr = 0; this.stepLen = 1; this.gateOffAt = -1;
    this.seqOn = true; this.held = []; // with the sequencer off: the MIDI notes held down, the last one sounding
  }
  // Seq off: a mono MIDI synth. The newest held note sounds; a note pressed while another is held slides to it without
  // retriggering (as a slide step does), letting go falls back to the note still held. Velocity 100 and up is an accent.
  // MIDI note 45 (A2) is code 33, 110 Hz, the pattern's A; notes outside the pattern's 64 codes are folded in by octaves.
  _noteCode(n) { let c = (n | 0) - 12; while (c < 0) c += 12; while (c > 63) c -= 12; return c; }
  _note(on, n, vel) {
    const h = this.held, i = h.indexOf(n);
    if (i >= 0) h.splice(i, 1);
    if (on) { const legato = h.length > 0; h.push(n); this.v.noteOn(this._noteCode(n), vel >= 100, legato); }
    else if (i === h.length && h.length) this.v.noteOn(this._noteCode(h[h.length - 1]), false, true); // the note let go was sounding
    else if (!h.length && i >= 0) this.v.noteOff();
  }
  message(m) {
    const v = this.v;
    if (m.type === 'knob') this.slew.set('k', m.name, m.value);
    else if (m.type === 'component') this.slew.set('c', m.name, m.value);
    else if (m.type === 'param') this.slew.set('f', m.name, m.value);
    else if (m.type === 'tune') v.setTune(m.value);
    else if (m.type === 'fx') v.setFx(m.name, m.value);
    else if (m.type === 'declick') { this.dc.setOn(!!m.on); this.dc.setFade(m.ms); }
    else if (m.type === 'pattern') this.pattern = m.value;
    else if (m.type === 'transpose') this.transpose = m.value | 0;
    else if (m.type === 'bpm') { this.bpm = m.value; v.bpm = m.value; v.dly.derive(v.knobs, m.value); }
    else if (m.type === 'groove') { this.shuffle = m.shuffle; this.gate = m.gate; }
    else if (m.type === 'ir') v.conv.setIR(m.id, m.L, m.R);
    else if (m.type === 'play') { this.playing = m.value; this.step = -1; this.ctr = 0; if (!m.value && this.seqOn) v.noteOff(); }
    else if (m.type === 'seq') {
      const on = !!m.value; if (on === this.seqOn) return;
      this.seqOn = on; this.held = []; this.step = -1; this.ctr = 0; this.gateOffAt = -1; v.noteOff();
    }
    else if (m.type === 'note') { if (!this.seqOn) this._note(!!m.on, m.note | 0, m.vel | 0); }
  }
  // a 16th note; shuffle lengthens the even steps and shortens the odd ones. Returns its length in samples.
  _startStep() {
    const P = this.pattern, n = P.length; if (!n) return 0;
    this.step = (this.step + 1) % n;
    const s = P[this.step], prev = P[(this.step - 1 + n) % n];
    const len = Math.round(this.fs * 60 / this.bpm / 4 * (1 + (this.step & 1 ? -this.shuffle : this.shuffle)));
    if (s.gate) {
      this.v.noteOn(s.code + this.transpose, s.accent, prev.gate && prev.slide);
      this.gateOffAt = s.slide ? -1 : Math.max(1, Math.round(len * this.gate));
    } else { this.v.noteOff(); this.gateOffAt = -1; }
    this.onStep(this.step);
    return len;
  }
  // fills out[s..e) (and outR, if given), split into runs at step starts, gate-offs and every 32 samples while slewing
  render(out, outR, s = 0, e = out.length) {
    let i = s; const seq = this.playing && this.seqOn;
    while (i < e) {
      if (seq && this.ctr <= 0) { this.stepLen = this._startStep() || 1; this.ctr = this.stepLen; }
      let run = e - i;
      if (this.slew.active) { run = Math.min(run, 32); this.slew.tick(run); }
      if (seq) {
        run = Math.min(run, this.ctr);
        const elapsed = this.stepLen - this.ctr;
        if (this.gateOffAt > elapsed) run = Math.min(run, this.gateOffAt - elapsed);
        else if (this.gateOffAt === elapsed) { this.v.noteOff(); this.gateOffAt = -1; }
      }
      this.dc.process(out, i, i + run, outR);
      i += run; if (seq) this.ctr -= run;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ...require('./fm/fm-voice.js'), ...require('./fx/fx.js'), SynthVoice, ParamSlew, DeClick, SynthEngine, SYNTH_LEVEL, FM_STEPPED };
