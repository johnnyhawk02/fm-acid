// ---------- inside the VST3 plug-in ----------
// The plug-in runs the same engine in C++ (plugin/engine) and plays it from the DAW's transport and tempo, so there is no
// Play button or Tempo dial (hidden in lcd.css). This page sends the engine what initAudio sends in a browser, and takes
// the playing step, the DAW tempo and MIDI CC back.
if (tbPlugin) {
  // a DAW parameter (automation) moved: set the control on the screen without sending it back
  let saveT = 0;
  const applyParam = (m) => {
    if (!m) return;
    if (m.type === 'knob' && m.name in state.knobs && typeof m.value === 'number') {
      if (Math.abs(state.knobs[m.name] - m.value) < 1e-6) return;
      state.knobs[m.name] = m.value; preview.setKnob(m.name, m.value); drawKnob(m.name);
      if (m.name === 'dlypp') drawDlyMode();
    } else if (m.type === 'fx' && m.name in state.fx) {
      if (state.fx[m.name] === !!m.value) return;
      state.fx[m.name] = !!m.value; preview.setFx(m.name, state.fx[m.name]); renderFx();
    } else if (m.type === 'slot' && m.n >= 0 && m.n < 8) { // the DAW's Pattern parameter
      if (m.n !== sel.n) loadSlot('A', m.n);
      return;
    } else if (m.type === 'wave' && (m.value === 'saw' || m.value === 'square')) {
      if (state.wave === m.value) return;
      state.wave = m.value; preview.waveform = m.value; drawWave();
    } else return;
    clearTimeout(saveT); saveT = setTimeout(saveSession, 400);
  };
  // a confirm/alert/prompt box stops the page's JavaScript, so the plug-in would think the page had died: tell it first
  for (const f of ['confirm', 'alert', 'prompt']) {
    const orig = window[f].bind(window);
    window[f] = (...a) => { send({ type: 'modal', on: true }); try { return orig(...a); } finally { send({ type: 'modal', on: false }); } };
  }
  // what the plug-in plays now wins over the session the page saved (automation may have moved it while the window was shut)
  for (const m of tbPlugin.info?.engine || []) applyParam(m);
  tbPlugin.on((m) => {
    if (!m) return;
    if (m.type === 'ping') send({ type: 'pong' }); // the plug-in checks the page is still alive
    else if (m.type === 'step') markStep(m.step);
    else if (m.type === 'param') applyParam(m.m);
    else if (m.type === 'bpm') { if (typeof m.value === 'number' && isFinite(m.value)) { state.bpm = Math.round(m.value * 100) / 100; bpmVal.textContent = state.bpm; } }
    else if (m.type === 'midi' && Array.isArray(m.data)) onMidi({ data: m.data });
    // Cmd+C / Cmd+V / Cmd+Z, which the DAW's Edit menu would otherwise take: replayed as the keydown the page listens for
    else if (m.type === 'key' && /^[a-z]$/.test(m.key)) {
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: m.key, code: 'Key' + m.key.toUpperCase(), metaKey: true, shiftKey: !!m.shift, bubbles: true, cancelable: true }));
    }
  });
  // while a text field has focus, Cmd+C / Cmd+V are the field's own
  const textField = (t) => !!t?.closest?.('input[type=text], input[type=number], input[type=search], input:not([type]), textarea, [contenteditable=""], [contenteditable=true]');
  document.addEventListener('focusin', (e) => send({ type: 'typing', on: textField(e.target) }));
  document.addEventListener('focusout', () => send({ type: 'typing', on: false }));
  for (const k of KNOBS) send({ type: 'knob', name: k.id, value: state.knobs[k.id] });
  for (const k in state.parts) if (state.parts[k] !== COMPONENTS[k].v) send({ type: 'component', name: k, value: state.parts[k] });
  send({ type: 'wave', value: state.wave }); sendTune(); sendPattern(); sendGroove();
  for (const n in state.fx) send({ type: 'fx', name: n, value: state.fx[n] });
  sendDeclick();
  send({ type: 'ready' });
}
