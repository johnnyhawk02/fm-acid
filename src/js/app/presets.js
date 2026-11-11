// ---------- presets ----------
function soundSnap() { const x = snapshot(); return { knobs: x.knobs, fm: x.fm, ...(x.tune && { tune: x.tune }), ...(x.seqs && { seqs: x.seqs }), fx: x.fx }; }
function applySound(x) {
  const c = cleanSettings(x);
  for (const k of KNOBS) state.knobs[k.id] = c.knobs[k.id] ?? k.def;
  for (const p of FM_PARAMS) state.fm[p.id] = c.fm[p.id] ?? p.def; // a sound from the 303 app has none: the default FM sound
  state.tune = c.tune || new Array(12).fill(0); sendTune();
  cseqReleaseAll(); state.seqs = c.seqs || {}; // a sound without sequencers clears them
  state.fx = c.fx || { rat: false, lex: false, dly: false, fold: false, flg: false };
  for (const n in state.fx) send({ type: 'fx', name: n, value: state.fx[n] });
  renderFx();
  for (const k of KNOBS) send({ type: 'knob', name: k.id, value: state.knobs[k.id] });
  for (const p of FM_PARAMS) sendFm(p.id);
  drawFmAll(); drawTune(); for (const id in knobEls) drawKnob(id); cseqLoaded(); saveSession();
}
function applyPattern(x) {
  const c = cleanSettings(x);
  if (c.bpm) { state.bpm = c.bpm; drawBpm(); send({ type: 'bpm', value: state.bpm }); }
  if (c.shuffle != null) state.shuffle = c.shuffle; if (c.gate != null) state.gate = c.gate;
  if (c.pattern) { state.pattern = c.pattern; tail = []; }
  renderSeq(); pushPattern();
}
function loadStore(key) { const v = store.get(key, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function presetBar(pre, storeKey, builtins, snap, apply, autoName) {
  const sel = document.getElementById(pre + '-preset'), nameEl = document.getElementById(pre + '-name');
  const delBtn = document.getElementById(pre + '-del'), msg = document.getElementById(pre + '-msg');
  const bar = { user: loadStore(storeKey), say: (t) => { msg.textContent = t; clearTimeout(bar.t); bar.t = setTimeout(() => { msg.textContent = ''; }, 4000); } };
  let armed = '';
  // factory presets can't be removed from the file, so "deleting" one hides it (restorable)
  const hidKey = 'hidden.' + pre, hidden = new Set(store.get(hidKey, []));
  const esc = (n) => n.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  bar.render = (selected) => {
    const opt = (g, n) => `<option value="${g}:${esc(n)}">${esc(n.split(' / ').pop())}</option>`;
    const names = Object.keys(bar.user).sort((a, b) => a.localeCompare(b));
    const groups = {};
    for (const n of Object.keys(builtins)) if (!hidden.has(n)) (groups[n.includes(' / ') ? n.split(' / ')[0] : 'Factory'] ||= []).push(n);
    sel.innerHTML = '<option value="">Choose…</option>'
      + Object.entries(groups).map(([g, ns]) => `<optgroup label="${esc(g)}">` + ns.map(n => opt('b', n)).join('') + '</optgroup>').join('')
      + (names.length ? '<optgroup label="Saved">' + names.map(n => opt('u', n)).join('') + '</optgroup>' : '');
    sel.value = selected || '';
    delBtn.disabled = !sel.value.startsWith('u:'); armed = ''; delBtn.textContent = 'Delete';
    sel.dispatchEvent(new Event('sync'));
  };
  bar.save = () => store.set(storeKey, bar.user);
  // auto-namer: fill the name box with a suggestion, unless the person typed their own
  let suggested = '';
  bar.suggest = (force) => {
    if (!autoName || (!force && nameEl.value.trim() && nameEl.value !== suggested)) return;
    nameEl.value = suggested = autoName(bar.user);
  };
  sel.addEventListener('change', () => {
    const v = sel.value; delBtn.disabled = !v.startsWith('u:'); armed = ''; delBtn.textContent = 'Delete';
    if (!v) return;
    const name = v.slice(2);
    apply(v[0] === 'b' ? builtins[name] : bar.user[name]);
    if (v[0] === 'u') nameEl.value = name;
    bar.say(`Loaded ${name}.`);
  });
  document.getElementById(pre + '-save').onclick = () => {
    if (autoName && !nameEl.value.trim()) bar.suggest(true);
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); bar.say('Type a name first, then save.'); return; }
    suggested = '';
    const existed = name in bar.user;
    bar.user[name] = snap(); bar.save(); bar.render('u:' + name);
    bar.say(existed ? `Updated ${name}.` : `Saved ${name}.`);
  };
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById(pre + '-save').click(); });
  delBtn.onclick = () => {
    const v = sel.value; if (!v.startsWith('u:')) return;
    const name = v.slice(2);
    if (armed !== name) { armed = name; delBtn.textContent = 'Confirm delete'; bar.say(`Click Confirm delete to remove ${name}.`); return; }
    delete bar.user[name]; bar.save(); bar.render(''); bar.say(`Deleted ${name}.`);
  };
  // delete from the picker's X: own presets are removed, factory ones hidden
  bar.remove = (v) => {
    const name = v.slice(2), keep = sel.value === v ? '' : sel.value;
    if (v[0] === 'u') delete bar.user[name], bar.save();
    else { hidden.add(name); store.set(hidKey, [...hidden]); }
    bar.render(keep); bar.say(`Deleted ${name}.`);
  };
  bar.hiddenCount = () => [...hidden].filter(n => n in builtins).length;
  bar.restore = () => { const n = bar.hiddenCount(); hidden.clear(); store.set(hidKey, []); bar.render(sel.value); bar.say(`Restored ${n} factory preset${n === 1 ? '' : 's'}.`); };
  (presetBar.all ||= {})[pre] = bar;
  bar.render('');
  return bar;
}
// ---------- preset menu: our own picker over the hidden <select>, grouped, searchable, with prev/next ----------
function presetMenu(host) {
  const sel = document.getElementById(host.dataset.for), pre = host.dataset.for.replace('-preset', '');
  host.innerHTML = `<button type="button" class="pm-btn" aria-haspopup="listbox" aria-expanded="false"><span class="cur"></span></button>`
    + `<button type="button" class="pm-step" data-d="-1" aria-label="Previous preset">◀</button><button type="button" class="pm-step" data-d="1" aria-label="Next preset">▶</button>`
    + `<div class="pm-pop" hidden><div class="pm-head"><div class="pm-qrow"><input type="text" class="pm-q" placeholder="Search" aria-label="Search presets"><button type="button" class="pm-favf" aria-pressed="false" title="Show favourites only">★</button></div>`
    + `</div><div class="pm-list" role="listbox" aria-label="${sel.getAttribute('aria-label')}"></div></div>`;
  host.querySelector('.pm-pop').appendChild(host.parentElement.querySelector('.pm-foot'));
  const btn = host.querySelector('.pm-btn'), pop = host.querySelector('.pm-pop'), q = host.querySelector('.pm-q'), list = host.querySelector('.pm-list');
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const favKey = 'fav.' + pre, recKey = 'recent.' + pre, openKey = 'pmOpen.' + pre;
  const fav = new Set(store.get(favKey, [])), open = new Set(store.get(openKey, ['fav', 'rec', 'my', 'built']));
  const bar = presetBar.all && presetBar.all[pre];
  let armed = '';
  let recent = store.get(recKey, []), act = -1, tree = null, order = [], byV = new Map(), favOnly = !!store.get('favOnly.' + pre, false);

  // every option becomes an item with a folder path: My presets, Built-in, or source > author > song
  function build() {
    const items = [...sel.querySelectorAll('option')].filter(o => o.value).map(o => {
      const v = o.value, full = v.slice(2);
      let path, name = full;
      if (v.startsWith('u:')) path = ['my'];
      else if (full.includes(' / ')) {
        const [grp, nm] = full.split(' / '); name = nm;
        path = [grp];
      } else path = ['built'];
      name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      return { v, name, path, label: name };
    });
    byV = new Map(items.map(it => [it.v, it]));
    const root = { kids: new Map(), items: [] };
    const node = (path) => { let n = root; for (const k of path) { if (!n.kids.has(k)) n.kids.set(k, { key: (n.key ? n.key + '/' : '') + k, label: k, kids: new Map(), items: [] }); n = n.kids.get(k); } return n; };
    for (const it of items) node(it.path).items.push(it);
    // multi-part songs ("Name - Part") become one row inside their folder
    const songs = (n) => {
      const stems = new Map();
      for (const it of n.items) { const i = it.name.indexOf(' - '); if (i > 0) { const st = it.name.slice(0, i); (stems.get(st) || stems.set(st, []).get(st)).push(it); } }
      for (const [st, its] of stems) if (its.length > 1) {
        const k = { key: n.key + '/' + st, label: st, kids: new Map(), items: its, song: true };
        for (const it of its) it.label = it.name.slice(st.length + 3);
        n.items = n.items.filter(it => !its.includes(it)); n.kids.set(st, k);
      }
      for (const c of n.kids.values()) if (!c.song) songs(c);
    };
    for (const c of root.kids.values()) if (c.key !== 'my' && c.key !== 'built') songs(c);
    const LABEL = { my: 'My presets', built: 'Factory' };
    for (const [k, c] of root.kids) if (LABEL[k]) c.label = LABEL[k];
    const sortN = (n) => { n.items.sort((a, b) => coll.compare(a.label, b.label)); for (const c of n.kids.values()) sortN(c); };
    sortN(root);
    // top level order: mine, built-in, then sources A-Z
    const top = [...root.kids.values()].sort((a, b) => (a.key === 'my' ? -2 : a.key === 'built' ? -1 : 0) - (b.key === 'my' ? -2 : b.key === 'built' ? -1 : 0) || coll.compare(a.label, b.label));
    tree = top; order = [];
    // folders before loose items inside a folder, song rows sorted in with folders
    const walk2 = (n) => { n.sorted = [...n.kids.values()].sort((a, b) => (a.song - b.song) || coll.compare(a.label, b.label)); for (const c of n.sorted) walk2(c); };
    for (const t of top) walk2(t);
    const flatten = (n) => { for (const c of n.sorted) if (!c.song) flatten(c); const rows = [...n.sorted.filter(c => c.song).map(c => ({ song: c })), ...n.items.map(it => ({ it }))].sort((a, b) => coll.compare((a.song || a.it).label, (b.song || b.it).label)); for (const r of rows) if (r.song) order.push(...r.song.items); else order.push(r.it); };
    for (const t of top) flatten(t);
    recent = recent.filter(v => byV.has(v)); for (const v of [...fav]) if (!byV.has(v)) fav.delete(v);
  }
  const small = () => byV.size <= 14;
  const pathText = (it) => it.path.map(k => ({ my: 'My presets', built: 'Factory' }[k] || k)).join(' › ');
  function sync() {
    const it = byV.get(sel.value);
    btn.querySelector('.cur').textContent = it ? it.name : 'Choose…';
  }
  const row = (it, d, hint) => `<div class="pm-row" style="--d:${d}"><button type="button" class="pm-i" role="option" data-v="${esc(it.v)}" aria-selected="${it.v === sel.value}">${esc(hint ? it.name : it.label)}${hint ? `<span class="pm-path">${esc(pathText(it))}</span>` : ''}</button>`
    + `<button type="button" class="pm-star" data-v="${esc(it.v)}" aria-pressed="${fav.has(it.v)}" aria-label="${fav.has(it.v) ? 'Remove from' : 'Add to'} favourites">${fav.has(it.v) ? '★' : '☆'}</button>`
    + (bar ? `<button type="button" class="pm-del" data-v="${esc(it.v)}" aria-pressed="${armed === it.v}" aria-label="Delete ${esc(it.name)}" title="${armed === it.v ? 'Click again to delete' : 'Delete'}">${armed === it.v ? 'delete?' : '×'}</button>` : '') + '</div>';
  const folder = (key, label, n, d) => `<button type="button" class="pm-g${d ? ' sub' : ''}" style="--d:${d}" data-g="${esc(key)}" aria-expanded="${open.has(key)}">${esc(label)}<span class="n">${n}</span></button>`;
  const count = (n) => n.items.length + [...n.kids.values()].reduce((a, c) => a + count(c), 0);
  function drawNode(n, d) {
    let h = folder(n.key, n.label, count(n), d);
    if (!open.has(n.key)) return h;
    const rows = [...n.sorted.map(c => ({ c })), ...n.items.map(it => ({ it }))];
    rows.sort((a, b) => (a.c && !a.c.song ? 0 : 1) - (b.c && !b.c.song ? 0 : 1) || coll.compare((a.c || a.it).label, (b.c || b.it).label));
    for (const r of rows) h += r.c ? drawNode(r.c, d + 1) : row(r.it, d + 1);
    if (n.key === 'built' && bar && bar.hiddenCount()) h += `<button type="button" class="pm-restore" style="--d:${d + 1}">restore ${bar.hiddenCount()} deleted</button>`;
    return h;
  }
  function draw() {
    if (!byV.has(armed)) armed = '';
    const term = q.value.trim().toLowerCase(); let h = '';
    if (term || favOnly) {
      const hits = order.filter(it => (!favOnly || fav.has(it.v)) && (!term || (it.name + ' ' + pathText(it)).toLowerCase().includes(term)));
      h = hits.slice(0, 300).map(it => row(it, 0, byV.size > 14)).join('');
      h = (hits.length && term ? `<div class="pm-sum">${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > 300 ? ', first 300 shown' : ''}</div>` : '') + h;
    } else {
      if (small()) h = order.map(it => row(it, 0)).join('') + (bar && bar.hiddenCount() ? `<button type="button" class="pm-restore" style="--d:0">restore ${bar.hiddenCount()} deleted</button>` : '');
      else for (const t of tree) h += drawNode(t, 0);
    }
    list.innerHTML = h || `<div class="pm-none">${!byV.size ? 'No presets yet. Save one below.' : favOnly && !term ? 'No favourites yet. Tap ☆ on a preset to add it.' : 'Nothing matches.'}</div>`;
    act = -1;
  }
  function show() {
    build();
    const it = byV.get(sel.value);
    if (it) { let k = ''; for (const p of it.path) { k = k ? k + '/' + p : p; open.add(k); } const i = it.name.indexOf(' - '); if (i > 0) open.add(it.path.join('/') + '/' + it.name.slice(0, i)); }
    q.value = ''; draw(); pop.hidden = false; pop.style.maxHeight = Math.max(240, Math.min(520, innerHeight - btn.getBoundingClientRect().bottom - 16)) + 'px'; btn.setAttribute('aria-expanded', 'true');
    if (matchMedia('(pointer: fine)').matches) q.focus();
    list.querySelector('.pm-g ~ .pm-row [aria-selected=true], .pm-row [aria-selected=true]')?.scrollIntoView({ block: 'center' });
  }
  function hide(refocus) { armed = ''; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); }
  function choose(v, remember) {
    sel.value = v; sel.dispatchEvent(new Event('change')); sync();
    if (remember) { recent = [v, ...recent.filter(x => x !== v)].slice(0, 8); store.set(recKey, recent); }
  }
  btn.onclick = () => (pop.hidden ? show() : hide());
  host.querySelectorAll('.pm-step').forEach(b => b.onclick = () => {
    build(); const L = favOnly && order.some(it => fav.has(it.v)) ? order.filter(it => fav.has(it.v)) : order; if (!L.length) return;
    const d = +b.dataset.d, i = L.findIndex(it => it.v === sel.value);
    choose(L[i < 0 ? (d > 0 ? 0 : L.length - 1) : (i + d + L.length) % L.length].v);
  });
  list.addEventListener('click', (e) => {
    const g = e.target.closest('.pm-g');
    if (g) { open.has(g.dataset.g) ? open.delete(g.dataset.g) : open.add(g.dataset.g); store.set(openKey, [...open]); const y = list.scrollTop; draw(); list.scrollTop = y; return; }
    const st = e.target.closest('.pm-star');
    if (st) { const v = st.dataset.v; fav.has(v) ? fav.delete(v) : fav.add(v); store.set(favKey, [...fav]); const y = list.scrollTop; draw(); list.scrollTop = y; return; }
    const dl = e.target.closest('.pm-del');
    if (dl) { const v = dl.dataset.v, y = list.scrollTop; if (armed !== v) { armed = v; bar.say(`Click delete? again to remove ${byV.get(v).name}.`); draw(); } else { armed = ''; bar.remove(v); } list.scrollTop = y; return; }
    if (e.target.closest('.pm-restore')) { const y = list.scrollTop; bar.restore(); list.scrollTop = y; return; }
    if (armed) { armed = ''; const y = list.scrollTop; draw(); list.scrollTop = y; }
    const it = e.target.closest('.pm-i'); if (it) { choose(it.dataset.v, true); hide(true); }
  });
  q.addEventListener('input', draw);
  const favBtn = host.querySelector('.pm-favf');
  favBtn.setAttribute('aria-pressed', favOnly);
  favBtn.onclick = () => { favOnly = !favOnly; favBtn.setAttribute('aria-pressed', favOnly); store.set('favOnly.' + pre, favOnly); draw(); };
  pop.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.pm-i, .pm-g')];
    if (e.key === 'Escape') { e.preventDefault(); hide(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length) return;
      act = Math.max(0, Math.min(items.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((el, i) => el.classList.toggle('act', i === act)); items[act].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && act >= 0 && items[act]) { e.preventDefault(); items[act].click(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !host.contains(e.target)) hide(); });
  sel.addEventListener('sync', () => { build(); sync(); if (!pop.hidden) { const y = list.scrollTop; draw(); list.scrollTop = y; } }); sel.addEventListener('change', sync);
  build(); sync();
}
