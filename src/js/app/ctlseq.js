// ---------- per-control step sequencers (after elixir-mobile's fader sequencers) ----------
// Long-press a dial (500 ms, cancelled if the pointer moves more than 6 px) or right-click it, and a pop-up opens with its
// own step sequencer: 2 to 64 steps (edited a page of 16 at a time), each an OFFSET from the dial's setting, up or down by
// up to Depth of its range. While the pattern plays, each step lasts Speed (a 16th up to 8 bars), counted on the bar's
// 16ths from the start and wrapped at the length (so short ones run against the bar), jumping to the step's offset or,
// with Slew, gliding to it over that share of a step. The dial still moves its setting meanwhile (the value heard is the
// setting plus the offset), and stopping, or switching the sequencer off, puts the dial back to its setting. The steps
// come from the engine's own step messages (the shuffle included); in the plug-in those follow the DAW's transport.
// A dial with a sequencer switched on is marked; the sequencers are part of the sound, so presets and the session keep them.
// (state.seqs and the shapes are in state.js; drawKnob, setKnob, drawPartKnob and applyPart ask cseqHeard for the value heard.)
var cseqRt = {};             // key -> { off, glide }: the offset each running sequencer is at
var cseqN = -1, cseqLastI = -1; // the 16th count since play started, and the last step message
var cseqCur = null;          // the control whose pop-up is open: { key, label }
function cseqOn(key) { return !!state.seqs[key]?.on; }
function cseqHeard(key, base) {
  const r = cseqRt && cseqRt[key], q = state.seqs[key];
  if (!r || !r.off || !q) return base;
  return Math.min(1, Math.max(0, base + r.off * q.depth / 100));
}
// a part's value heard (parts move along their dial's 0-1 travel); the exact setting when nothing is moving it
function cseqPartValue(k) {
  const t = toSlider(k, state.parts[k]) / SL, h = cseqHeard('p:' + k, t);
  return h === t ? state.parts[k] : fromSlider(k, h * SL);
}
// send the value heard to the engine and show it on the dial
function cseqPush(key) {
  const id = key.slice(2);
  if (key[0] === 'k') {
    const h = cseqHeard(key, state.knobs[id]), k = knobEls[id];
    send({ type: 'knob', name: id, value: h });
    if (k) { knobDraw(k.el, state.knobs[id]); knobHeard(k.el, cseqOn(key) ? h : -1); k.val.textContent = knobText(id, h); }
  } else { send({ type: 'component', name: id, value: cseqPartValue(id) }); drawPartKnob(id); }
}
function cseqRelease(key) { if (!cseqRt[key]) return; delete cseqRt[key]; cseqPush(key); }
function cseqReleaseAll() {
  for (const key of Object.keys(cseqRt)) cseqRelease(key);
  cseqN = -1; cseqLastI = -1;
  if (cseqCur) cseqDrawNow(-1);
}
// one step of a control's sequencer: its offset, jumped to or glided to over Slew's share of the step
function cseqStep(key, q, k, ms) {
  const r = cseqRt[key] || (cseqRt[key] = { off: 0, glide: null }), to = q.vals[k] || 0;
  if (q.slew) { r.glide = { from: r.off, to, t0: performance.now(), ms: q.slew / 100 * ms }; cseqGlideRun(); }
  else { r.glide = null; r.off = to; cseqPush(key); }
  if (cseqCur && cseqCur.key === key) cseqDrawNow(k);
}
let cseqGliding = false;
function cseqGlideRun() {
  if (cseqGliding) return;
  cseqGliding = true;
  const tick = () => {
    const now = performance.now(); let any = false;
    for (const [key, r] of Object.entries(cseqRt)) {
      const g = r.glide; if (!g) continue;
      const k = Math.min(1, (now - g.t0) / Math.max(1, g.ms));
      r.off = g.from + (g.to - g.from) * k; cseqPush(key);
      if (k < 1 && state.seqs[key]?.on) any = true; else r.glide = null;
    }
    if (any) requestAnimationFrame(tick); else cseqGliding = false;
  };
  requestAnimationFrame(tick);
}
// each step message from the engine (markStep): a 16th. i is the step in the pattern (or the joined chain); -1 is stopped.
function cseqTick(i) {
  if (i < 0) { if (cseqLastI >= 0 || Object.keys(cseqRt).length) cseqReleaseAll(); return; }
  if (!tbPlugin && !playing) return; // a step message that was on its way when Stop was pressed
  const L = Math.max(1, chain.length >= 2 && chainOffs.length ? chainOffs[chainOffs.length - 1] : state.pattern.length);
  const fresh = cseqLastI < 0;
  // counted from the steps themselves, so a skipped message (the plug-in's screen polls) or a DAW locate stays in step
  if (fresh) cseqN = i; else { const d = ((i - cseqLastI) % L + L) % L; cseqN += d || L; }
  cseqLastI = i;
  const stepMs = 60000 / state.bpm / 4;
  for (const [key, q] of Object.entries(state.seqs)) {
    if (!q.on || (!fresh && cseqN % q.step)) continue;
    cseqStep(key, q, Math.floor(cseqN / q.step) % q.len, stepMs * q.step);
  }
}

// ---------- which dial is which ----------
const CSEQ_UNIT = { fold: 'folder', dly: 'delay', cmp: 'compactor', flg: 'flanger' };
function cseqKnobLabel(k) {
  let u = '';
  if (k.fx === 'rat') u = { rat: 'rat', ds: 'ds-1', ts: 'ts808' }[k.drv] || 'drive';
  else if (k.fx === 'lex') u = k.rev || '224';
  else if (k.fx) u = CSEQ_UNIT[k.fx] || k.fx;
  return (u ? u + ' ' : '') + k.name.toLowerCase();
}
function cseqCtl(t) {
  const kn = t?.closest?.('.knob'); if (!kn || kn.id === 'bpm') return null;
  const id = kn.id.startsWith('knob-') ? kn.id.slice(5) : '';
  if (id && knobEls[id]?.el === kn) {
    const k = KNOBS.find(x => x.id === id);
    return { key: 'k:' + id, el: kn, label: cseqKnobLabel(k), get: () => state.knobs[id], put: (v) => setKnob(id, v) };
  }
  const p = kn.dataset.k;
  if (p && p in COMPONENTS && !COMPONENTS[p].fixed) {
    const name = (kn.getAttribute('aria-label') || p).replace(/\s*\(.*\)\s*$/, '').toLowerCase();
    return { key: 'p:' + p, el: kn, label: name, get: () => state.parts[p], put: (v) => { applyPart(p, v); if (p === 'KT') drawKeyTrack(); if (p === 'I_REF') drawTrim(); } };
  }
  return null;
}
// the mark on every dial with a sequencer switched on (the Mods page redraws its dials, so this runs after that too)
function cseqMarks() {
  for (const el of document.querySelectorAll('.knob')) {
    const c = el.id === 'bpm' ? null : cseqCtl(el);
    const on = !!(c && cseqOn(c.key));
    el.classList.toggle('cseq', on);
    if (c && c.key[0] === 'k') knobHeard(el, on ? cseqHeard(c.key, state.knobs[c.key.slice(2)]) : -1);
    else if (c) knobHeard(el, on ? cseqHeard(c.key, toSlider(c.key.slice(2), state.parts[c.key.slice(2)]) / SL) : -1);
  }
}
// a sound was loaded: its sequencers (or none) replace the old ones
function cseqLoaded() {
  // the page going away (the plug-in's window shut) puts the dials back first, so the engine keeps their settings
addEventListener('pagehide', () => { for (const key of Object.keys(cseqRt)) cseqRelease(key); });
cseqMarks();
  if (cseqCur) { if (state.seqs[cseqCur.key]) cseqDraw(); else cseqClose(); }
}

// ---------- the pop-up ----------
const csDlg = document.getElementById('cseq'), csSteps = document.getElementById('cseq-steps'), csPages = document.getElementById('cseq-pages');
const csIn = { len: document.getElementById('cseq-len'), slew: document.getElementById('cseq-slew'), speed: document.getElementById('cseq-speed'), depth: document.getElementById('cseq-depth') };
const csCells = Array.from({ length: 16 }, (_, i) => {
  const c = document.createElement('div'); c.className = 'cs-step'; c.dataset.i = i;
  c.innerHTML = '<i class="cs-bar"></i>'; csSteps.append(c); return c;
});
for (let p = 0; p < CSEQ_MAX / 16; p++) {
  const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.p = p;
  b.textContent = `${p * 16 + 1}-${p * 16 + 16}`; b.setAttribute('aria-label', `Steps ${p * 16 + 1} to ${p * 16 + 16} (key ${p + 1})`);
  csPages.append(b);
}
// the kinds of randomise, each writing all 64 steps (so lengthening carries on): random: any offset each step; drunk: a
// walk, a small step up or down from the last; wobbly: two slow waves that come back round at the length; ramp: a rise or
// fall over the length; s&h: a new offset held for 2 to 4 steps; sparse: mostly none, now and then a spike
const csRr = () => Math.random() * 2 - 1;
const CSEQ_RAND = [
  ['random', () => Array.from({ length: CSEQ_MAX }, csRr)],
  ['drunk', () => { let v = csRr() * 0.5; return Array.from({ length: CSEQ_MAX }, () => { v += csRr() * 0.3; if (v > 1 || v < -1) v = Math.sign(v) * 2 - v; return v; }); }],
  ['wobbly', (n) => { const a = 1 + Math.floor(Math.random() * 2), b = 2 + Math.floor(Math.random() * 3), pa = Math.random() * 6.3, pb = Math.random() * 6.3, mix = 0.3 + Math.random() * 0.4;
    return Array.from({ length: CSEQ_MAX }, (_, i) => (1 - mix) * Math.sin(2 * Math.PI * a * i / n + pa) + mix * Math.sin(2 * Math.PI * b * i / n + pb)); }],
  ['ramp', (n) => { const up = Math.random() < 0.5; return Array.from({ length: CSEQ_MAX }, (_, i) => { const x = (i % n) / Math.max(1, n - 1) * 2 - 1; return up ? x : -x; }); }],
  ['s&h', () => { const hold = 2 + Math.floor(Math.random() * 3); let v = 0; return Array.from({ length: CSEQ_MAX }, (_, i) => { if (i % hold === 0) v = csRr(); return v; }); }],
  ['sparse', () => Array.from({ length: CSEQ_MAX }, () => (Math.random() < 0.22 ? csRr() : 0))],
];
let csKind = Math.max(0, CSEQ_RAND.findIndex(([n]) => n === store.get('cseqKind', 'random')));
let csPage = 0, csSel = 0, csNow = -1, csOpenedAt = 0, csReturn = null;
const csSpeedName = (v) => (v < 16 ? `1/${16 / v}` : v === 16 ? '1 bar' : `${v / 16} bars`);
const csPct = (o, q) => { const v = Math.round(Math.abs(o) * q.depth); return (o > 0 && v ? '+' : o < 0 && v ? '−' : '') + v + '%'; };
function cseqDraw() {
  if (!cseqCur) return;
  const q = state.seqs[cseqCur.key], at = csPage * 16;
  document.getElementById('cseq-name').textContent = cseqCur.label;
  csCells.forEach((c, i) => {
    const n = at + i, v = q.vals[n];
    c.style.setProperty('--v', v);
    c.classList.toggle('off', n >= q.len); c.classList.toggle('sel', n === csSel); c.classList.toggle('now', n === csNow);
    c.dataset.n = n + 1;
  });
  [...csPages.children].forEach((b, p) => {
    b.setAttribute('aria-selected', p === csPage); b.classList.toggle('past', p * 16 >= q.len);
    b.classList.toggle('now', csNow >= 0 && Math.floor(csNow / 16) === p);
  });
  const on = document.getElementById('cseq-on'); on.setAttribute('aria-pressed', q.on); on.textContent = q.on ? 'On' : 'Off';
  csIn.len.value = q.len; csIn.slew.value = q.slew; csIn.speed.value = CSEQ_SPEEDS.indexOf(q.step); csIn.depth.value = q.depth;
  document.getElementById('cseq-len-out').textContent = q.len;
  document.getElementById('cseq-slew-out').textContent = q.slew ? q.slew + '%' : 'off';
  document.getElementById('cseq-speed-out').textContent = csSpeedName(q.step);
  document.getElementById('cseq-depth-out').textContent = '±' + q.depth + '%';
  for (const el of Object.values(csIn)) { const f = (el.value - el.min) / ((el.max - el.min) || 1); el.style.setProperty('--f', f.toFixed(4)); }
  document.getElementById('cseq-kind').textContent = CSEQ_RAND[csKind][0];
  document.getElementById('cseq-val').textContent = `step ${csSel + 1}  ${csPct(q.vals[csSel], q)}`;
  csSteps.setAttribute('aria-valuetext', `Step ${csSel + 1} of ${q.len}, ${csPct(q.vals[csSel], q)}`);
  // the page going away (the plug-in's window shut) puts the dials back first, so the engine keeps their settings
addEventListener('pagehide', () => { for (const key of Object.keys(cseqRt)) cseqRelease(key); });
cseqMarks();
}
// the playing step, outlined (and its page marked) as the sequencer reaches it
function cseqDrawNow(k) {
  csNow = k;
  csCells.forEach((c, i) => c.classList.toggle('now', csPage * 16 + i === k));
  [...csPages.children].forEach((b, p) => b.classList.toggle('now', k >= 0 && Math.floor(k / 16) === p));
}
function cseqChanged() { cseqDraw(); saveSession(); }
function cseqOpen(c) {
  if (!state.seqs[c.key]) state.seqs[c.key] = newCtlSeq();
  const same = cseqCur?.key === c.key;
  cseqCur = { key: c.key, label: c.label };
  if (!same) { csPage = 0; csSel = 0; csNow = -1; }
  if (!csDlg.open) { csReturn = c.el; csOpenedAt = performance.now(); if (csDlg.showModal) csDlg.showModal(); else csDlg.setAttribute('open', ''); }
  cseqChanged(); csSteps.focus();
}
function cseqClose() { // (the close event tidies up)
  if (csDlg.open) { if (csDlg.close) csDlg.close(); else { csDlg.removeAttribute('open'); csDlg.dispatchEvent(new Event('close')); } }
}
csDlg.addEventListener('close', () => {
  // a sequencer left with every step at zero (opened for a look) is dropped, so the dial is not marked and nothing is saved
  const key = cseqCur?.key, q = key && state.seqs[key];
  if (q && q.vals.every(v => !v)) { delete state.seqs[key]; cseqRelease(key); cseqMarks(); saveSession(); }
  cseqCur = null; csNow = -1; const r = csReturn; csReturn = null; if (r?.isConnected) r.focus();
});
csDlg.addEventListener('cancel', (e) => { e.preventDefault(); cseqClose(); });
// a click on the dimmed backdrop (not on the card) closes it; not the release of the press that opened it
csDlg.addEventListener('click', (e) => { if (e.target === csDlg && performance.now() - csOpenedAt > 400) cseqClose(); });
document.getElementById('cseq-done').onclick = cseqClose;
document.getElementById('cseq-on').onclick = () => {
  const q = state.seqs[cseqCur.key]; q.on = !q.on; if (!q.on) cseqRelease(cseqCur.key); cseqChanged();
};
csPages.addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (!b) return; csPage = +b.dataset.p; csSel = csPage * 16 + (csSel % 16); cseqDraw(); });
document.getElementById('cseq-kind').onclick = () => { csKind = (csKind + 1) % CSEQ_RAND.length; store.set('cseqKind', CSEQ_RAND[csKind][0]); cseqDraw(); };
function cseqRandomise() { const q = state.seqs[cseqCur.key]; q.vals = CSEQ_RAND[csKind][1](q.len).map(cseqOff); q.on = true; cseqChanged(); }
document.getElementById('cseq-rand').onclick = cseqRandomise;
// the four bars: length 2-64, slew off to a whole step, speed a 16th to 8 bars, depth 0-100% of the dial's range
document.getElementById('cseq-bars').addEventListener('input', (e) => {
  const q = cseqCur && state.seqs[cseqCur.key]; if (!q) return;
  const v = +e.target.value;
  if (e.target === csIn.len) q.len = v;
  else if (e.target === csIn.slew) q.slew = v;
  else if (e.target === csIn.speed) q.step = CSEQ_SPEEDS[v] || 1;
  else if (e.target === csIn.depth) { q.depth = v; if (cseqRt[cseqCur.key]) cseqPush(cseqCur.key); }
  cseqChanged();
});
// painting: a step takes the offset at the pointer's height (the middle is none); dragging across paints the steps it passes
{
  let painting = null;
  const paint = (e) => {
    const q = state.seqs[cseqCur?.key]; if (!q) return;
    const r = csSteps.getBoundingClientRect();
    const col = Math.max(0, Math.min(7, Math.floor((e.clientX - r.left) / r.width * 8)));
    const row = Math.max(0, Math.min(1, Math.floor((e.clientY - r.top) / r.height * 2)));
    const c = csCells[row * 8 + col], cr = c.getBoundingClientRect(), n = csPage * 16 + row * 8 + col;
    if (n >= q.len) return;
    q.vals[n] = cseqOff(1 - 2 * (e.clientY - cr.top) / cr.height); csSel = n; painting.dirty = true;
    cseqDraw();
  };
  csSteps.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault(); csSteps.focus();
    try { csSteps.setPointerCapture(e.pointerId); } catch {}
    painting = { id: e.pointerId, dirty: false }; paint(e);
  });
  csSteps.addEventListener('pointermove', (e) => {
    if (!painting || e.pointerId !== painting.id) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { stop(e); return; }
    for (const p of (e.getCoalescedEvents?.() || []).concat(e)) paint(p);
  });
  const stop = (e) => { if (!painting || e.pointerId !== painting.id) return; if (painting.dirty) saveSession(); painting = null; };
  csSteps.addEventListener('pointerup', stop); csSteps.addEventListener('pointercancel', stop); csSteps.addEventListener('lostpointercapture', stop);
}
// keys while it is open: Left/Right pick a step, Up/Down nudge it a twentieth (Shift: a quarter), 1-4 pick the page,
// R randomises, Esc closes. The app's own key commands wait until it shuts (Space still plays and stops).
addEventListener('keydown', (e) => {
  if (!csDlg.open || !cseqCur) return;
  const q = state.seqs[cseqCur.key];
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cseqClose(); return; }
  if (e.key === 'Tab') { // focus stays in the card
    const f = [...csDlg.querySelectorAll('button, input, [tabindex="0"]')].filter(el => !el.disabled && el.offsetParent);
    const i = f.indexOf(document.activeElement), j = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
    e.preventDefault(); e.stopPropagation(); f[j]?.focus(); return;
  }
  if (e.code === 'Space' || e.metaKey || e.ctrlKey || e.altKey) return;
  const inRange = e.target?.type === 'range';
  const arrow = { ArrowLeft: -1, ArrowRight: 1 }[e.key], nudge = { ArrowUp: 1, ArrowDown: -1 }[e.key];
  if ((arrow || nudge) && inRange) { e.stopPropagation(); return; } // the bar's own arrows
  e.stopPropagation();
  if (arrow) {
    e.preventDefault(); csSel = Math.max(0, Math.min(q.len - 1, csSel + arrow)); csPage = Math.floor(csSel / 16); cseqDraw();
  } else if (nudge) {
    e.preventDefault(); q.vals[csSel] = cseqOff(q.vals[csSel] + nudge * (e.shiftKey ? 0.25 : 0.05)); cseqChanged();
  } else if (/^[1-4]$/.test(e.key)) {
    e.preventDefault(); csPage = +e.key - 1; csSel = csPage * 16 + (csSel % 16); cseqDraw();
  } else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); cseqRandomise(); }
}, true);

// ---------- opening it: long-press or right-click a dial ----------
{
  let hold = null;
  const cancel = () => { if (hold) { clearTimeout(hold.t); hold = null; } };
  document.addEventListener('pointerdown', (e) => {
    cancel();
    if (e.button !== 0 || csDlg.open) return;
    const c = cseqCtl(e.target); if (!c) return;
    const v0 = c.get();
    hold = { id: e.pointerId, x: e.clientX, y: e.clientY, t: setTimeout(() => {
      const h = hold; hold = null;
      try { c.el.releasePointerCapture(h.id); } catch {} // ends the dial's drag
      c.el.dispatchEvent(new Event('dialend'));
      if (c.get() !== v0) c.put(v0); // the hold may have nudged it
      cseqOpen(c);
    }, 500) };
  }, true);
  document.addEventListener('pointermove', (e) => { if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 6) cancel(); }, true);
  document.addEventListener('pointerup', cancel, true); document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('contextmenu', (e) => {
    const c = cseqCtl(e.target); if (!c) return;
    e.preventDefault(); cancel(); if (!csDlg.open || cseqCur?.key !== c.key) cseqOpen(c);
  });
}
// the Mods page dials are redrawn when a sound loads: mark them again
new MutationObserver(cseqMarks).observe(document.getElementById('mods'), { childList: true });
// the page going away (the plug-in's window shut) puts the dials back first, so the engine keeps their settings
addEventListener('pagehide', () => { for (const key of Object.keys(cseqRt)) cseqRelease(key); });
cseqMarks();
