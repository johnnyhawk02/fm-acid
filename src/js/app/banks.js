// ---------- the 8 pattern slots, A1-A8: edits save to the selected slot ----------
// (Storage and projects still name a slot by bank and number, { g: 'A', n }, from when there were
// banks A-D of 12; only bank A is used now, and the other old slots stay in storage but are not shown.)
const banks = store.get('banks', null) || {};
let sel = store.get('bankSel', null) || { g: 'A', n: 0 };
if (sel.g !== 'A' || !(sel.n >= 0 && sel.n < 8)) sel = { g: 'A', n: 0 };
const slotKey = (g, n) => g + (n + 1);
let clip = store.get('clip', null);
function blankPattern(len = 16) { return Array.from({ length: len }, () => restStep(24)); }
function storeSlot() {
  const k = slotKey(sel.g, sel.n), old = banks[k], pat = state.pattern.map(st => ({ ...st }));
  const same = old && JSON.stringify(old.pattern) === JSON.stringify(pat); // keep the auto-fill tag until the pattern is edited
  banks[k] = { shuffle: state.shuffle, gate: state.gate, pattern: pat, ...(same && old.auto ? { auto: true, name: old.name } : {}) };
  store.set('banks', banks);
}
// slots that are empty, or still hold an untouched random pick, get a random preset
function fillSlots(force) {
  const cur = slotKey(sel.g, sel.n); let n = 0;
  for (let i = 0; i < 8; i++) {
    const k = slotKey('A', i), x = banks[k];
    const empty = !x || !x.pattern?.some(st => st.gate);
    if (k === cur || !(empty || (force && x.auto))) continue;
    const gp = generatePattern(16, genDens);
    banks[k] = { shuffle: 0, gate: 0.5, pattern: gp.pattern, auto: true, name: gp.src }; n++;
  }
  store.set('banks', banks); return n;
}
function renderBank() {
  for (const b of document.querySelectorAll('#bk-n button')) {
    const n = +b.dataset.n, x = banks[slotKey(sel.g, n)];
    b.setAttribute('aria-pressed', n === sel.n);
    b.classList.toggle('used', !!x?.pattern?.some(s => s.gate));
    b.setAttribute('aria-label', `Pattern ${sel.g}${n + 1}`); b.title = x?.auto && x.name ? x.name.split(' / ').pop() : '';
  }
  document.getElementById('p-paste').disabled = !clip;
  renderChain();
}
function loadSlot(g, n) {
  storeSlot(); sel = { g, n }; store.set('bankSel', sel);
  const c = cleanSettings(banks[slotKey(g, n)]);
  state.pattern = c.pattern || blankPattern(); state.shuffle = c.shuffle ?? 0; state.gate = c.gate ?? 0.5;
  tail = []; sendGroove(); renderSeq(); pushPattern(); renderBank();
  if (tbPlugin) send({ type: 'slot', n }); // the plug-in's Pattern parameter follows
}
document.getElementById('bk-n').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (e.metaKey || e.ctrlKey) toggleChain(b); else loadSlot(sel.g, +b.dataset.n); };
document.getElementById('p-copy').onclick = () => { clip = { shuffle: state.shuffle, gate: state.gate, pattern: state.pattern.map(st => ({ ...st })) }; store.set('clip', clip); renderBank(); };
document.getElementById('p-paste').onclick = () => {
  const c = cleanSettings(clip); if (!c.pattern) return;
  pushUndo();
  state.pattern = c.pattern; state.shuffle = c.shuffle ?? state.shuffle; state.gate = c.gate ?? state.gate;
  tail = []; sendGroove(); renderSeq(); pushPattern();
};
document.getElementById('p-clear').onclick = () => { pushUndo(); state.pattern = blankPattern(state.pattern.length); tail = []; renderSeq(); pushPattern(); };
function pushPattern() { store.set('pattern', state.pattern); storeSlot(); sendPattern(); renderBank(); saveSession(); }

// ---------- chains: right-click slots to play several patterns in a row ----------
let chain = (store.get('chain', null) || []).filter(k => /^A[1-8]$/.test(k));
let chainOffs = []; // start step of each chained pattern in the joined sequence
const slotPattern = (k) => cleanSettings(banks[k]).pattern || blankPattern();
function sendPattern() {
  if (chain.length < 2) { chainOffs = []; send({ type: 'pattern', value: state.pattern }); return; }
  const all = []; chainOffs = [];
  for (const k of chain) { chainOffs.push(all.length); all.push(...slotPattern(k)); }
  chainOffs.push(all.length);
  send({ type: 'pattern', value: all });
}
// a step from the engine, as [chain index, step within that pattern]
function chainPos(i) {
  if (i < 0 || chain.length < 2) return [-1, i];
  let c = 0; while (c < chain.length - 1 && i >= chainOffs[c + 1]) c++;
  return [c, i - chainOffs[c]];
}
let playingSlot = '';
function renderChain() {
  const el = document.getElementById('chain-read');
  el.hidden = chain.length < 2;
  el.querySelector('.ch-list').innerHTML = chain.map(k => `<span class="${k === playingSlot ? 'now' : ''}">${k}</span>`).join('<span class="arr">›</span>');
  for (const b of document.querySelectorAll('#bk-n button')) {
    const k = slotKey(sel.g, +b.dataset.n), pos = chain.indexOf(k);
    b.dataset.ch = pos >= 0 && chain.length > 1 ? pos + 1 : '';
    b.classList.toggle('playing', chain.length > 1 && k === playingSlot);
  }
}
// Cmd-click (Ctrl-click on Windows) or right-click adds or removes a slot
let lastChainTap = { k: '', t: 0 };
document.getElementById('bk-n').addEventListener('contextmenu', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); toggleChain(b); } });
function toggleChain(b) {
  const k0 = slotKey(sel.g, +b.dataset.n), now = performance.now();
  if (lastChainTap.k === k0 && now - lastChainTap.t < 350) return; // one gesture can fire both click and contextmenu
  lastChainTap = { k: k0, t: now };
  const k = slotKey(sel.g, +b.dataset.n), pos = chain.indexOf(k);
  if (pos >= 0) chain.splice(pos, 1); else { if (!chain.length && k !== slotKey(sel.g, sel.n)) chain.push(slotKey(sel.g, sel.n)); chain.push(k); }
  if (chain.length === 1 && chain[0] === slotKey(sel.g, sel.n) && pos >= 0) chain = [];
  store.set('chain', chain); sendPattern(); renderChain();
}
// number keys 1-8 pick that pattern slot in the current bank (Johnny), except while typing
document.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !/^Digit[1-8]$/.test(e.code)) return;
  if (e.target.closest?.('input[type=text], textarea, select, [contenteditable=""], [contenteditable=true]') || document.getElementById('options').open) return;
  e.preventDefault(); document.querySelector(`#bk-n [data-n="${+e.code.slice(5) - 1}"]`)?.click();
});
