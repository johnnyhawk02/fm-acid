// the waveform switch sits at the left of the voice panel; component randomise and its undo at the right
panel.insertAdjacentHTML('afterbegin', `<div class="kn wave-kn" role="group" aria-label="Waveform"><span class="name" aria-hidden="true" style="visibility: hidden">Waveform</span>
  <div class="wave-row"><svg class="wglyph" viewBox="0 0 20 12" aria-hidden="true"><path d="M1 11 L9 1 V11 L17 1 V11"/></svg>
  <button type="button" class="switch" id="wave-sw" role="switch" aria-checked="false" aria-label="Square wave"><span class="thumb"></span></button>
  <svg class="wglyph" viewBox="0 0 20 12" aria-hidden="true"><path d="M1 11 V1 H10 V11 H19 V1"/></svg></div>
  <span class="val" id="wave-val" aria-hidden="true" style="visibility: hidden">Saw</span></div>`);
const waveSw = document.getElementById('wave-sw');
// Key track: the KT part (a TD-3-MO / Devil Fish style mod), as a full front-panel dial after Reso
document.getElementById('knob-resonance').parentElement.insertAdjacentHTML('afterend', `<div class="kn kt-kn" title="Key track: higher notes open the filter. About a third is exact 1 V/oct; full is about 300%, so low notes almost vanish. 0 is the stock 303. Double-click to reset.">
  <div class="knob" data-k="KT" tabindex="0" role="slider" aria-label="Key track" aria-valuemin="0" aria-valuemax="100" id="knob-kt">${knobSVG()}</div>
  <div class="name">Key track</div><div class="ref">KT 100K(B)</div><div class="val" id="kt-val"></div></div>`);
const ktEl = document.getElementById('knob-kt');
function drawKeyTrack() {
  drawPartKnob('KT');
  const el = document.getElementById('kt-val'); if (!el) return;
  el.textContent = state.parts.KT > 0 ? Math.round(preview.wKt / (VT * Math.LN2) * 100) + '%' : 'off';
}
bindDial(ktEl, { get: () => partT('KT'), set: (_, t) => { setPartT('KT', t, true); drawKeyTrack(); }, min: 0, max: 1,
  reset: () => { applyPart('KT', COMPONENTS.KT.v); drawKeyTrack(); }, start: () => ktEl.parentElement.classList.add('active') });
ktEl.addEventListener('dialend', () => ktEl.parentElement.classList.remove('active'));
panel.insertAdjacentHTML('beforeend', `<div class="kn parts-kn"><span class="name">Components</span>
  <div class="trim" title="TM3 filter frequency trimmer: shifts the cutoff about an octave either way. Double-click to reset.">
    <div class="knob" data-k="I_REF" tabindex="0" role="slider" aria-label="Filter trim (TM3)" aria-valuemin="0" aria-valuemax="100">${knobSVG()}</div>
    <span class="tname">Filter trim</span><span class="tval" id="trim-val"></span></div>
  <button type="button" class="mini" id="parts-rand" title="New unit: every part lands inside its real tolerance, like another 303 off the line">New unit</button>
  <button type="button" class="mini" id="parts-bend" title="Messed up: every part bent well outside spec, circuit-bending style. Tuning parts are left alone so it stays in tune">Messed up</button>
  <button type="button" class="mini" id="parts-undo" disabled>Undo</button></div>`);
// TM3 filter trimmer: the factory cutoff calibration pot, shown as a little trimmer under the voice knobs
const trimEl = panel.querySelector('.trim .knob');
function drawTrim() {
  drawPartKnob('I_REF');
  const oct = Math.log2(state.parts.I_REF / COMPONENTS.I_REF.v), el = document.getElementById('trim-val');
  if (!el) return;
  el.textContent = (oct >= 0 ? '+' : '') + (oct * 12).toFixed(1) + ' st'; el.classList.toggle('changed', Math.abs(oct) > 1e-4);
}
bindDial(trimEl, { get: () => partT('I_REF'), set: (_, t) => { setPartT('I_REF', t); drawTrim(); }, drag: 240, fine: 800, focus: true,
  reset: () => { applyPart('I_REF', COMPONENTS.I_REF.v); drawTrim(); } });
drawTrim(); drawKeyTrack();
const partsUndo = [];
function syncPartsUndo() { document.getElementById('parts-undo').disabled = !partsUndo.length; }
document.getElementById('parts-rand').onclick = () => FUNCTIONS.parts();
document.getElementById('parts-bend').onclick = () => FUNCTIONS.parts(true);
document.getElementById('parts-undo').onclick = () => {
  const u = partsUndo.pop(); if (!u) return;
  applySound({ ...soundSnap(), parts: u }); syncPartsUndo(); sqSay('Part values put back.');
};
// no saw/square word under the switch (Johnny: the icons say it); the hidden val keeps the cell the same height as the dials
function drawWave() { waveSw.setAttribute('aria-checked', state.wave === 'square'); }
waveSw.onclick = () => {
  const w = state.wave === 'square' ? 'saw' : 'square';
  state.wave = w; preview.waveform = w; drawWave(); send({ type: 'wave', value: w }); saveSession();
};

