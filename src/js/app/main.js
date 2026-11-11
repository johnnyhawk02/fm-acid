// ---------- main tabs ----------
const mtabs = document.getElementById('mtabs');
function showPane(name, focus) {
  if (!document.getElementById('pane-' + name)) name = 'seq';
  for (const b of mtabs.querySelectorAll('[role=tab]')) { const on = b.dataset.pane === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
  for (const p of document.querySelectorAll('.main > .pane')) p.hidden = p.id !== 'pane-' + name;
  store.set('mainTab', name);
}
mtabs.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) showPane(b.dataset.pane, true); });
mtabs.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (!d) return;
  const tabs = [...mtabs.querySelectorAll('[role=tab]')], i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
  showPane(tabs[(i + d + tabs.length) % tabs.length].dataset.pane, true); e.preventDefault();
});
showPane(store.get('mainTab', 'seq'));

renderFx(); renderSeq(); renderBank();
