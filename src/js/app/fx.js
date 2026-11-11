// ---------- reverb slot: Lexicon 224, plate, spring, convolution ----------
// each unit's program buttons: [knob, programs, number, short name, full name]
const REV_PROGS = {
  lex: ['lexprog', LEX_PROGRAMS.map(P => [P.n, P.short, P.name])],
  plate: ['plateprog', PLATE_PROGRAMS.map((P, i) => [i + 1, P.short, P.name])],
  spring: ['sprprog', SPRING_PROGRAMS.map((P, i) => [i + 1, P.short, P.name])],
  conv: ['cnvprog', CNV_PROGRAMS.map((P, i) => [i + 1, P.short, P.name])],
};
// ---------- type menus: the drive pedal, the reverb unit and its program, picked from dropdowns (Johnny), styled like Randomise ▾ ----------
// el: an empty .tmenu div; items: [{ name, tip }]; pick(i) runs when one is chosen. setTypeItems swaps the list (the
// program menu changes with the unit); drawTypeMenu ticks the current one and shows it on the button.
function setTypeItems(el, items) {
  el.lastElementChild.innerHTML = items.map((T, i) => `<button type="button" role="menuitemradio" aria-checked="false" data-t="${i}" title="${T.tip}">${T.name}</button>`).join('');
}
function typeMenu(el, items, pick) {
  el.innerHTML = `<button type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${el.dataset.label}"></button><div class="fn-menu" role="menu" hidden></div>`;
  setTypeItems(el, items);
  const btn = el.firstElementChild, menu = el.lastElementChild;
  const open = (on) => {
    menu.hidden = !on; btn.setAttribute('aria-expanded', on);
    if (on) (menu.querySelector('[aria-checked=true]') || menu.querySelector('button')).focus();
  };
  btn.onclick = () => { for (const m of document.querySelectorAll('.tmenu .fn-menu:not([hidden])')) if (m !== menu) m.parentElement.firstElementChild.click(); open(menu.hidden); };
  menu.addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; open(false); pick(+b.dataset.t); btn.focus(); });
  menu.addEventListener('keydown', (e) => {
    const bs = [...menu.querySelectorAll('button')], j = bs.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open(false); btn.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(j + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !el.contains(e.target)) open(false); });
}
function drawTypeMenu(el, t, also = []) {
  const items = el.querySelectorAll('.fn-menu button');
  for (const b of items) b.setAttribute('aria-checked', +b.dataset.t === t);
  // the button is as wide as the longest choice (invisible copies of every name stacked under the current one), so
  // picking a shorter or longer one never moves the controls beside it
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (items[t]) { el.firstElementChild.innerHTML = `<span class="tm-w"><span>${esc(items[t].textContent)}</span>${[...[...items].map(b => b.textContent), ...also].map(n => `<span aria-hidden="true">${esc(n)}</span>`).join('')}</span>`; el.firstElementChild.title = items[t].title; }
}
{
  typeMenu(document.getElementById('rev-type'), REV_TYPES.map(T => ({ name: T.name, tip: T.name })), (i) => setKnob('revtype', i / 3));
  typeMenu(document.getElementById('rev-prog'), [], (i) => {
    const [knob, list] = REV_PROGS[REV_TYPES[revType(state.knobs)].id]; setKnob(knob, list.length > 1 ? i / (list.length - 1) : 0);
  });
}
// recorded impulse responses for Conv (irs/irs.json): the list loads when Conv is shown, the samples when audio is running,
// decoded at the audio rate on this thread and handed to the engine
let irMeta = null, irFailed = false, irMetaP = null, irSentTo = null;
function loadIRMeta() {
  irMetaP ||= fetch('irs/irs.json').then(r => r.json()).then(m => { irMeta = m; drawLex(); return m; }).catch(() => { irFailed = true; irMetaP = null; drawLex(); return null; });
  return irMetaP;
}
async function loadIRs() {
  if (!ctx || irSentTo === ctx) return; irSentTo = ctx;
  const m = await loadIRMeta(); if (!m) { irSentTo = null; return; }
  for (const ir of m.irs) {
    try {
      const buf = await ctx.decodeAudioData(await (await fetch('irs/' + ir.file)).arrayBuffer());
      const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      send({ type: 'ir', id: ir.id, L: L.slice(), R: R.slice() });
    } catch (e) { console.warn('IR', ir.id, e && e.message); }
  }
}
const LEX_CHORUS_NAMES = { lexbass: 'Pair 1', lexmid: 'Pair 2', lexxover: 'Pair 3', lextreble: 'Pair 4', lexdepth: 'Wander' };
let revShown = '';
const REV_PROG_NAMES = REV_TYPES.map(T => REV_PROGS[T.id][1].map(([n, , name]) => `${T.id === 'lex' ? 'P' : ''}${n} ${name}`)).flat();
function drawLex() {
  const progs = document.getElementById('rev-prog'); if (!progs || !knobEls.lexmix) return;
  const t = revType(state.knobs), T = REV_TYPES[t], [pk, list] = REV_PROGS[T.id];
  drawTypeMenu(document.getElementById('rev-type'), t);
  if (revShown !== T.id) { // this unit's programs and dials
    revShown = T.id;
    setTypeItems(progs, list.map(([n, , name]) => ({ name: `${T.id === 'lex' ? 'P' : ''}${n} ${name}`, tip: name })));
    for (const k of KNOBS) if (k.fx === 'lex' && knobEls[k.id]) knobEls[k.id].wrap.hidden = (k.rev || 'lex') !== T.id;
  }
  const sel = revProg(state.knobs[pk], list.length);
  drawTypeMenu(progs, sel, REV_PROG_NAMES); // as wide as the longest program of any unit, so switching units moves nothing
  if (T.id === 'conv') { loadIRMeta(); loadIRs(); }
  if (T.id !== 'lex') {
    const q = { plate: plateParams, spring: springParams, conv: convParams }[T.id](state.knobs);
    for (const k of KNOBS) if (k.rev === T.id && knobEls[k.id]) {
      knobEls[k.id].name.textContent = k.id === 'cnvdecay' ? (q.P.gate ? 'Gate' : q.P.ir ? 'Length' : 'Decay') : k.name;
      knobEls[k.id].val.textContent = knobText(k.id, state.knobs[k.id]);
    }
    return;
  }
  const q = lexParams(state.knobs), chorus = q.P.alg === 'chorus';
  for (const k of KNOBS) if (k.fx === 'lex' && !k.rev && knobEls[k.id]) { const e = knobEls[k.id]; e.name.textContent = (chorus && LEX_CHORUS_NAMES[k.id]) || k.name; e.val.textContent = knobText(k.id, state.knobs[k.id]); }
}

// ---------- drive slot: ProCo RAT, Boss DS-1, Ibanez TS808 (fx.rat switches it on, drvtype picks the pedal) ----------
const DRV_TYPES = [
  { id: 'rat', name: 'Rodent', tip: 'Rodent: LM308 op-amp into a diode pair, Filter after' },
  { id: 'ds', name: 'Dist One', tip: 'Dist One: transistor booster, op-amp into a diode pair to ground, LPF/HPF tone blend' },
  { id: 'ts', name: 'Green 808', tip: 'Green 808: diodes in the op-amp feedback, active tone stage' },
];
typeMenu(document.getElementById('drv-type'), DRV_TYPES, (i) => setKnob('drvtype', i / 2));
// a function declaration with no top-level consts, so drawKnob can call it before this file has run
function drawDrv() {
  const t = Math.max(0, Math.min(2, Math.round((state.knobs.drvtype || 0) * 2))), id = ['rat', 'ds', 'ts'][t];
  drawTypeMenu(document.getElementById('drv-type'), t);
  for (const k of KNOBS) if (k.drv && knobEls[k.id]) knobEls[k.id].wrap.hidden = k.drv !== id;
}
drawDrv();

// ---------- effects ----------
const FX_UNITS = ['fold', 'rat', 'flg', 'dly', 'lex'];
function renderFx() {
  for (const n of FX_UNITS) {
    const b = document.getElementById('fx-' + n + '-on');
    b.setAttribute('aria-pressed', !!state.fx[n]); b.textContent = state.fx[n] ? 'On' : 'Off';
    document.getElementById('fx-' + n).classList.toggle('on', !!state.fx[n]);
  }
  document.getElementById('fx-cmp').classList.toggle('on', !!(state.fx.lex || state.fx.dly)); // the Compactor acts on the returns
  drawDlyMode(); drawFlgMode(); drawDrv(); drawRoute();
}
// Delay mode: ping-pong or mono (stored as the dlypp knob)
const dlyModeEl = document.getElementById('dly-mode');
function drawDlyMode() {
  const pp = state.knobs.dlypp >= 0.5 ? 1 : 0; for (const b of dlyModeEl.children) b.setAttribute('aria-checked', +b.dataset.m === pp);
}
// Flanger mode: flanger or chorus (the flgmode knob). A function declaration with no top-level consts, so drawKnob can call it early
function drawFlgMode() {
  const el = document.getElementById('flg-mode'); if (!el) return;
  const m = state.knobs.flgmode >= 0.5 ? 1 : 0; for (const b of el.children) b.setAttribute('aria-checked', +b.dataset.m === m);
  if (knobEls.flgres) knobEls.flgres.wrap.classList.toggle('dim', m === 1); // no feedback in chorus mode
}
document.getElementById('flg-mode').addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) setKnob('flgmode', +b.dataset.m); });
dlyModeEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) { setKnob('dlypp', +b.dataset.m); drawDlyMode(); } });
for (const n of FX_UNITS) document.getElementById('fx-' + n + '-on').onclick = () => {
  state.fx[n] = !state.fx[n]; preview.setFx(n, state.fx[n]); send({ type: 'fx', name: n, value: state.fx[n] });
  renderFx(); saveSession();
};


// ---------- routing: a small block diagram of the signal path (Johnny) ----------
// fxorder swaps the folder and the drive slot; fxret sets how the delay and reverb returns connect (parallel, or one
// into the other). The dry signal always passes by the returns; the Compactor ducks the returns. Click a block to switch
// that unit on or off. A function declaration with no top-level consts, so drawKnob can call it before this file has run.
function drawRoute() {
  const svg = document.getElementById('route-dia'); if (!svg) return;
  const k = state.knobs, fx = state.fx, swap = k.fxorder >= 0.5, ret = Math.max(0, Math.min(2, Math.round((k.fxret || 0) * 2)));
  for (const [id, v] of [['route-order', swap ? 1 : 0], ['route-ret', ret]])
    for (const b of document.getElementById(id).children) b.setAttribute('aria-checked', Math.round(+b.dataset.v * (id === 'route-ret' ? 2 : 1)) === v);
  const drv = ['rodent', 'dist one', 'green'][Math.max(0, Math.min(2, Math.round((k.drvtype || 0) * 2)))];
  const rev = REV_TYPES[revType(k)].short.toLowerCase();
  const W = 62, H = 18, Y = 24; // block size, main row centre
  const blk = (unit, label, x, y, on, tip) => `<g class="rb${on ? ' on' : ''}" data-tip="${tip}"${unit ? ` data-u="${unit}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${label}"` : ''}>` +
    `<rect x="${x}" y="${y - H / 2}" width="${W}" height="${H}" rx="2"/><text x="${x + W / 2}" y="${y + 5}">${label}</text></g>`;
  const ln = (pts) => `<polyline class="rw" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
  const arr = (x, y) => `<path class="ra" d="M${x - 5} ${y - 3.5} L${x} ${y} L${x - 5} ${y + 3.5}Z"/>`;
  const pre = swap ? [['rat', drv, fx.rat, 'Drive'], ['fold', 'folder', fx.fold, 'Folder']] : [['fold', 'folder', fx.fold, 'Folder'], ['rat', drv, fx.rat, 'Drive']];
  pre.push(['flg', k.flgmode >= 0.5 ? 'chorus' : 'flanger', fx.flg, 'Flanger']);
  let h = `<text class="rt" x="0" y="${Y + 5}">303</text>`;
  pre.forEach(([u, label, on, tip], i) => { const x = 36 + i * 74; h += ln([[x - 10 - (i ? 0 : -2), Y], [x, Y]]) + arr(x, Y) + blk(u, label, x, Y, on, tip); });
  const sx = 270, cx = 428, ox = 506; // split, Compactor, sum
  h += ln([[246, Y], [sx, Y]]) + `<circle class="rn" cx="${sx}" cy="${Y}" r="2.5"/>`;
  const dlyB = (x, y) => blk('dly', 'delay', x, y, fx.dly, 'Delay'), revB = (x, y) => blk('lex', rev, x, y, fx.lex, 'Reverb');
  if (ret === 0) { // side by side
    const yt = 12, yb = 46, x = 304, mx = 390;
    h += ln([[sx, Y], [sx + 14, Y], [sx + 14, yt], [x, yt]]) + arr(x, yt) + ln([[sx + 14, Y], [sx + 14, yb], [x, yb]]) + arr(x, yb);
    h += dlyB(x, yt) + revB(x, yb);
    h += ln([[x + W, yt], [mx, yt], [mx, Y], [cx, Y]]) + ln([[x + W, yb], [mx, yb], [mx, Y]]) + arr(cx, Y);
  } else { // one into the other
    const [a, b] = ret === 1 ? [dlyB, revB] : [revB, dlyB];
    h += ln([[sx, Y], [280, Y]]) + arr(280, Y) + a(280, Y) + ln([[342, Y], [352, Y]]) + arr(352, Y) + b(352, Y) + ln([[414, Y], [cx, Y]]) + arr(cx, Y);
  }
  h += blk('', 'duck', cx, Y, fx.lex || fx.dly, 'Ducker: ducks the delay and reverb returns under the synth');
  h += ln([[cx + W, Y], [ox - 7, Y]]) + arr(ox - 7, Y);
  // the dry signal, under the returns
  const dy = ret === 0 ? 58 : 50;
  h += ln([[sx, Y], [sx, dy], [ox, dy], [ox, Y + 7]]) + `<path class="ra" d="M${ox - 3.5} ${Y + 12} L${ox} ${Y + 7} L${ox + 3.5} ${Y + 12}Z"/>`;
  h += `<text class="rt rs" x="${ox - 30}" y="${dy - 3}">dry</text>`;
  h += `<circle class="rs-sum" cx="${ox}" cy="${Y}" r="7"/><path class="rw" d="M${ox - 4} ${Y} H${ox + 4} M${ox} ${Y - 4} V${Y + 4}"/>`;
  h += ln([[ox + 7, Y], [ox + 20, Y]]) + arr(ox + 20, Y) + `<text class="rt" x="${ox + 24}" y="${Y + 5}">out</text>`;
  svg.innerHTML = h;
}
{
  const pick = (id, knob) => document.getElementById(id).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) setKnob(knob, +b.dataset.v); });
  pick('route-order', 'fxorder'); pick('route-ret', 'fxret');
  const svg = document.getElementById('route-dia');
  const hit = (e) => { const g = e.target.closest('[data-u]'); if (g) document.getElementById('fx-' + g.dataset.u + '-on').click(); };
  svg.addEventListener('click', hit);
  svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hit(e); } });
  drawRoute();
}
