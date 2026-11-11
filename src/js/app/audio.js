// ---------- transport / audio ----------
const playBtn = document.getElementById('play'), status = document.getElementById('status');
let playing = false;
async function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.connect(ctx.destination);
  const src = document.getElementById('model').textContent + '\n' + document.getElementById('worklet-src').textContent;
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'tb303', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = (e) => { if (e.data.type === 'step') markStep(e.data.step); };
    node.connect(analyser);
  } catch (err) {
    console.warn("worklet failed", err && err.message);
    // Fallback: run the same voice on the main thread
    fallback = makeFallback(); fallback.sp.connect(analyser);
  }
  document.getElementById('rate').textContent = `2× of ${ctx.sampleRate / 1000} kHz`;
  for (const k of KNOBS) send({ type: 'knob', name: k.id, value: state.knobs[k.id] });
  for (const k in state.parts) if (state.parts[k] !== COMPONENTS[k].v) send({ type: 'component', name: k, value: state.parts[k] });
  send({ type: 'wave', value: state.wave }); sendTune(); send({ type: 'bpm', value: state.bpm }); sendPattern(); sendGroove(); sendTranspose(); sendSeq();
  for (const n in state.fx) send({ type: 'fx', name: n, value: state.fx[n] });
  sendDeclick();
  if (revType(state.knobs) === 3) loadIRs();
}
// no AudioWorklet: the same engine on the main thread through a ScriptProcessor
function makeFallback() {
  const sp = ctx.createScriptProcessor(1024, 0, 2), eng = new TB303Engine(ctx.sampleRate, markStep);
  sp.onaudioprocess = (e) => eng.render(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
  return { sp, msg: (m) => eng.message(m) };
}
let lastStep = -1;
function markStep(i) {
  cseqTick(i); // the per-control step sequencers step with the pattern (ctlseq.js)
  const [c, local] = chainPos(i);
  if (c >= 0) { const k = chain[c]; i = k === slotKey(sel.g, sel.n) ? local : -1; if (k !== playingSlot) { playingSlot = k; requestAnimationFrame(renderChain); } }
  else if (playingSlot && i < 0) { playingSlot = ''; requestAnimationFrame(renderChain); }
  requestAnimationFrame(() => {
    for (const el of seqCols[lastStep] || []) el.classList.remove('cur');
    for (const el of seqCols[i] || []) el.classList.add('cur'); lastStep = i;
  });
}
let triedLock = false;
async function lockLandscape() {
  if (triedLock || !matchMedia('(pointer: coarse)').matches) return; triedLock = true;
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); await screen.orientation?.lock?.('landscape'); } catch {}
}
playBtn.onclick = async () => {
  if (tbPlugin) return; // the DAW's transport plays the plug-in
  lockLandscape();
  if (!ctx) { try { await initAudio(); } catch (e) { status.textContent = 'Audio could not start in this browser'; return; } }
  if (ctx.state === 'suspended') await ctx.resume();
  playing = !playing;
  send({ type: 'play', value: playing });
  playBtn.setAttribute('aria-pressed', playing); playBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  status.textContent = playing ? (node ? 'Running · AudioWorklet' : 'Running · main thread') : 'Stopped';
  if (!playing) markStep(-1);
};
// tempo dial: drag or arrows, 60-200 BPM; double-click to type a value
// spacebar plays and stops, except while typing in a text field
const typing = (t) => t.closest?.('input, textarea, select, [contenteditable=""], [contenteditable=true]');
document.addEventListener('keydown', (e) => {
  if (tbPlugin || e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
  e.preventDefault(); playBtn.click();
}, true);
document.addEventListener('keyup', (e) => { if (!tbPlugin && e.code === 'Space' && !typing(e.target)) e.preventDefault(); }, true);
// Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste the current pattern slot (text fields and selected text keep their normal copy/paste)
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat || typing(e.target) || document.getElementById('options').open) return;
  const k = e.key.toLowerCase();
  if (k === 'c') {
    if (String(getSelection() || '')) return;
    e.preventDefault(); document.getElementById('p-copy').click(); sqSay(`Copied ${sel.g}${sel.n + 1}.`);
  } else if (k === 'v') {
    if (!clip) return;
    e.preventDefault(); document.getElementById('p-paste').click(); sqSay(`Pasted into ${sel.g}${sel.n + 1}. Undo puts it back.`);
  }
});
const bpmKnob = document.getElementById('bpm'), bpmVal = document.getElementById('bpm-val');
bpmKnob.innerHTML = knobSVG();
function drawBpm() {
  const p = (state.bpm - 60) / 140;
  knobDraw(bpmKnob, p);
  bpmKnob.setAttribute('aria-valuenow', state.bpm); bpmVal.textContent = state.bpm;
}
function setBpm(v) {
  v = Math.min(200, Math.max(60, Math.round(v))); if (v === state.bpm) return;
  state.bpm = v; drawBpm(); send({ type: 'bpm', value: v }); saveSession();
}
bindDial(bpmKnob, { get: () => state.bpm, set: (_, v) => setBpm(v), drag: 2, fine: 8, step: 1, page: 10,
  reset: () => { const v = parseInt(prompt('Tempo (60–200 BPM)', state.bpm), 10); if (v) setBpm(v); } });
