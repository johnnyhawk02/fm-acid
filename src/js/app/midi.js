// ---------- MIDI: CC 1 onwards, any channel ----------
// CC 1-11 are the front panel's dials left to right, then the Operators page's four columns (CC 12-27).
const fmCc = (id, name) => ({ name, set: (t) => setFm(id, fmFromNorm(fmP(id), t)) });
const MIDI_MAP = [{ name: 'Tuning', set: (t) => setKnob('tuning', t) }, ...PANEL_FM.map(([id, name]) => fmCc(id, name)), { name: 'Volume', set: (t) => setKnob('volume', t) },
  ...OPS.flatMap(o => [['r', 'ratio'], ['l', 'level'], ['a', 'attack'], ['d', 'decay']].map(([k, n]) => fmCc(k + o, `Op ${o} ${n}`)))];
// Notes (any channel, octaves named as in Logic and Ableton, C3 = middle C = note 60): C0-G0 (24-31) pick pattern 1-8,
// C1-C3 (36-60) set the root note the pattern plays from, C1 as written, each semitone up shifts it up one. The root
// note is a performance setting: it is not saved and comes back to C1 when the page loads.
const NOTE_PAT = 24, NOTE_ROOT = 36, ROOT_MAX = 24;
let midiTranspose = 0;
function sendTranspose() { send({ type: 'transpose', value: midiTranspose }); }
document.getElementById('midi-map').innerHTML = MIDI_MAP.map((m, i) => `<dt>CC ${i + 1}</dt><dd>${m.name}</dd>`).join('')
  + '<dt>C0-G0</dt><dd>Pattern 1-8</dd><dt>C1-C3</dt><dd>Root note (C1 = as written)</dd>'
  + '<dt>Seq off</dt><dd>Notes play the synth (A2 = 110 Hz, velocity 100+ accents, overlapping notes slide)</dd>';
// ---------- Seq on/off (the small button by Play) ----------
// Off, the step sequencer stops and the synth is a mono MIDI synth: every note plays the voice (the engine's 'note'
// message), and the pattern and root-note notes above are just notes. A setting, not part of a sound or preset; in the
// plug-in it is saved with the instance (the engine's 'seq' message is in its state), in a browser in this browser.
const seqBtn = document.getElementById('seq-on');
let seqOn = tbPlugin ? !(tbPlugin.info?.engine || []).some(m => m && m.type === 'seq' && m.value === false) : store.get('seqOn', true) !== false;
function sendSeq() { send({ type: 'seq', value: seqOn }); }
function drawSeq() {
  seqBtn.setAttribute('aria-pressed', seqOn); seqBtn.setAttribute('aria-label', seqOn ? 'Sequencer on' : 'Sequencer off, MIDI notes play the synth');
  playBtn.disabled = !seqOn; document.documentElement.toggleAttribute('data-seqoff', !seqOn);
}
async function startAudioForMidi() { // a browser starts audio on a click or key, so Seq off needs one before MIDI can sound
  if (tbPlugin || seqOn) return;
  if (!ctx) { try { await initAudio(); } catch { return; } }
  if (ctx.state === 'suspended') try { await ctx.resume(); } catch {}
}
seqBtn.onclick = () => {
  seqOn = !seqOn; if (!tbPlugin) store.set('seqOn', seqOn);
  if (!seqOn && playing) playBtn.click(); // stop the pattern first, so Play shows stopped
  sendSeq(); drawSeq(); if (!seqOn) markStep(-1);
  startAudioForMidi();
};
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, startAudioForMidi, true);
drawSeq(); if (tbPlugin) sendSeq();
const midiPending = new Map(); let midiFrame = 0;
function onMidiNote(note, vel) {
  if (!seqOn) { send({ type: 'note', on: true, note, vel }); return; }
  if (note >= NOTE_PAT && note < NOTE_PAT + 8) { const n = note - NOTE_PAT; if (n !== sel.n) loadSlot(sel.g, n); }
  else if (note >= NOTE_ROOT && note <= NOTE_ROOT + ROOT_MAX && note - NOTE_ROOT !== midiTranspose) { midiTranspose = note - NOTE_ROOT; sendTranspose(); }
}
function onMidi(e) {
  const [st, cc, val] = e.data;
  if ((st & 0xf0) === 0x90 && val > 0) { onMidiNote(cc, val); return; }
  if ((st & 0xf0) === 0x80 || (st & 0xf0) === 0x90) { if (!seqOn) send({ type: 'note', on: false, note: cc, vel: 0 }); return; }
  if ((st & 0xf0) !== 0xb0 || cc < 1 || cc > MIDI_MAP.length) return;
  midiPending.set(cc, val / 127);
  if (!midiFrame) midiFrame = requestAnimationFrame(() => { midiFrame = 0; for (const [c, t] of midiPending) MIDI_MAP[c - 1].set(t); midiPending.clear(); });
}
if (tbPlugin) document.getElementById('midi-status').textContent = 'In the plug-in, MIDI comes from the DAW track, all channels. C3 = middle C.';
else if (navigator.requestMIDIAccess) {
  const midiStatus = document.getElementById('midi-status');
  navigator.requestMIDIAccess().then((acc) => {
    const hook = () => { const ins = [...acc.inputs.values()]; for (const i of ins) i.onmidimessage = onMidi;
      midiStatus.textContent = ins.length ? `Listening on ${ins.map(i => i.name).join(', ')}, all channels. C3 = middle C.` : 'No MIDI input connected. Plug one in and it is picked up straight away.'; };
    hook(); acc.onstatechange = hook;
  }, () => { midiStatus.textContent = 'MIDI access was refused or is not available here.'; });
} else document.getElementById('midi-status').textContent = 'This browser has no Web MIDI. Chrome and Edge have it.';

