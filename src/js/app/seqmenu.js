// ---------- Randomise and Tools menus, and pattern key commands ----------
// Johnny: the pattern buttons live in two menus at the right of the pattern row instead of on the page. Randomise holds
// the random and alter tools, Shuffle, Generate and Refill; Tools holds Copy, Paste, Double, Clear, Undo, moving the notes
// and joining the chain. Gate ▾ beside them picks how long each note sounds (key E). Every item has a key, shown in the menu and in the status-line tooltip. Keys are plain letters
// (Shift for the gentler Alter versions) and never clash with 1-8 (pattern slots), Space (play) or Cmd/Ctrl+C/V (copy,
// paste, handled in audio.js). Keys are ignored while typing in a text field or with Options open.
(() => {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const cmd = mac ? '⌘' : 'Ctrl+', shift = mac ? '⇧' : 'Shift+';
  const click = (sel) => () => { const b = document.querySelector(sel); if (b && !b.disabled) b.click(); };
  const MENUS = [['rm-btn', 'rm-menu'], ['tm-btn', 'tm-menu'], ['gm-btn', 'gm-menu']].map(([b, m]) => ({ btn: document.getElementById(b), menu: document.getElementById(m) }));
  const open = (M, on) => {
    for (const o of MENUS) if (o !== M || !on) { o.menu.hidden = true; o.btn.setAttribute('aria-expanded', false); }
    if (on) { M.menu.hidden = false; M.btn.setAttribute('aria-expanded', true); (M.menu.querySelector('[aria-checked=true]') || M.menu.querySelector('button:not(:disabled)'))?.focus(); }
  };
  const toggle = (i) => () => open(MENUS[i], MENUS[i].menu.hidden);
  // each action: what it runs, its key (code, shift, cmd, and a label when the code is not a letter), and the element
  // that shows the key: a menu item with data-rm="<id>", or the element with id="<id>" (a real button that runs itself)
  const ACTS = {
    'r-acc': { run: () => randomise('accent'), code: 'KeyA' },
    'r-sld': { run: () => randomise('slide'), code: 'KeyS' },
    'r-oct': { run: () => randomise('octave'), code: 'KeyO' },
    'a-acc': { run: () => alterLane('accent'), code: 'KeyA', shift: true },
    'a-sld': { run: () => alterLane('slide'), code: 'KeyS', shift: true },
    'a-oct': { run: () => alterLane('octave'), code: 'KeyO', shift: true },
    'alter': { run: () => FUNCTIONS.alter(), code: 'KeyL' },
    'p-shuf': { run: () => shuffleSteps(), code: 'KeyH' },
    'rand': { run: click('#rand'), code: 'KeyG' },
    'p-refill': { run: click('#p-refill'), code: 'KeyG', shift: true },
    'p-copy': { code: 'KeyC', cmd: true },            // the keys themselves are handled in audio.js
    'p-paste': { code: 'KeyV', cmd: true },
    'p-dup': { run: click('#p-dup'), code: 'KeyD' },
    'p-clear': { run: click('#p-clear'), code: 'Backspace', shift: true, label: '⌫' },
    'p-undo': { run: click('#p-undo'), code: 'KeyZ', cmd: true },
    'nu-up': { run: () => nudgeNotes(1), code: 'BracketRight', label: ']' },
    'nu-dn': { run: () => nudgeNotes(-1), code: 'BracketLeft', label: '[' },
    'nu-oup': { run: () => nudgeNotes(12), code: 'BracketRight', shift: true, label: ']' },
    'nu-odn': { run: () => nudgeNotes(-12), code: 'BracketLeft', shift: true, label: '[' },
    'rot-l': { run: () => rotateSteps(-1), code: 'Comma', label: ',' },
    'rot-r': { run: () => rotateSteps(1), code: 'Period', label: '.' },
    'join': { run: () => FUNCTIONS.join(), code: 'KeyJ' },
    'rm-btn': { run: toggle(0), code: 'KeyR' },
    'tm-btn': { run: toggle(1), code: 'KeyT' },
    'gm-btn': { run: toggle(2), code: 'KeyE' },     // Gate ▾ (its items are drawn by renderSide in sequencer.js)
  };
  const keyName = (a) => (a.cmd ? cmd : '') + (a.shift ? shift : '') + (a.label || a.code.slice(3));
  for (const [id, a] of Object.entries(ACTS)) {
    const el = document.querySelector(`[data-rm="${id}"]`) || document.getElementById(id); if (!el) continue;
    const k = keyName(a), tip = el.getAttribute('title') || el.dataset.tip || el.textContent.trim();
    el.title = `${tip} (key ${k})`;
    if (el.closest('.fn-menu')) el.insertAdjacentHTML('beforeend', `<kbd>${k}</kbd>`);
  }
  // the cross under the roll shows its keys too
  for (const [sel, ids] of [['.dp-up', ['nu-up', 'nu-oup']], ['.dp-dn', ['nu-dn', 'nu-odn']], ['.dp-lt', ['rot-l']], ['.dp-rt', ['rot-r']]]) {
    const b = document.querySelector(sel); if (b) b.title = `${b.title} (key ${ids.map(id => keyName(ACTS[id])).join(', ')})`;
  }
  MENUS.forEach((M, i) => {
    M.btn.onclick = toggle(i);
    M.menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      open(M, false);
      if (b.dataset.rm) ACTS[b.dataset.rm].run();   // items with an id are the real buttons and run their own onclick
    });
    M.menu.addEventListener('keydown', (e) => {
      const items = [...M.menu.querySelectorAll('button:not(:disabled)')], j = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open(M, false); M.btn.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(j + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
    });
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.rmenu')) for (const M of MENUS) if (!M.menu.hidden) open(M, false); });
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.altKey || e.isComposing) return;
    if (e.target.closest?.('input[type=text], input[type=number], input:not([type]), textarea, select, [contenteditable=""], [contenteditable=true]')) return;
    if (document.getElementById('options').open) return;
    const c = e.metaKey || e.ctrlKey;
    const hit = Object.entries(ACTS).find(([, a]) => a.run && a.code === e.code && !!a.shift === e.shiftKey && !!a.cmd === c);
    if (!hit) return;
    e.preventDefault();
    if (!/^(rm|tm|gm)-btn$/.test(hit[0])) for (const M of MENUS) if (!M.menu.hidden) open(M, false);
    hit[1].run();
  });
})();
