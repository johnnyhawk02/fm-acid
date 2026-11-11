// ---------- projects: everything at once (sound, effects, tempo, the 8 pattern slots, chain) ----------
const SLOT_RE = /^A[1-8]$/;
function projectSnap() {
  storeSlot();
  return { sound: soundSnap(), bpm: state.bpm, sel: { ...sel }, chain: [...chain],
    banks: Object.fromEntries(Object.entries(banks).filter(([k]) => SLOT_RE.test(k)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])) };
}
// a preset is a whole project, or (folded in from the old separate lists) just a sound or just a pattern
const sndOnlyEl = document.getElementById('prj-sndonly');
sndOnlyEl.checked = !!store.get('prjSoundOnly', false);
sndOnlyEl.onchange = () => store.set('prjSoundOnly', sndOnlyEl.checked);
function applyPreset(x) {
  if (!x || typeof x !== 'object') return;
  if (x.kind === 'pattern') { if (!sndOnlyEl.checked) { applyPattern({ ...x.pattern, bpm: undefined }); storeSlot(); renderBank(); saveSession(); } return; }
  if (x.kind === 'sound' || sndOnlyEl.checked) { applySound(x.sound || {}); return; }
  applyProject({ ...x, bpm: undefined }); // presets keep the current tempo (Johnny)
}
function applyProject(x) {
  if (!x || typeof x !== 'object') return;
  if (x.sound) applySound(x.sound); else applySound({});
  if (typeof x.bpm === 'number') { state.bpm = Math.min(200, Math.max(60, Math.round(x.bpm))); drawBpm(); send({ type: 'bpm', value: state.bpm }); }
  if (x.banks && typeof x.banks === 'object') {
    for (const k of Object.keys(banks)) delete banks[k];
    for (const [k, v] of Object.entries(x.banks)) {
      if (!SLOT_RE.test(k)) continue;
      const c = cleanSettings(v); if (!c.pattern) continue;
      banks[k] = { shuffle: c.shuffle ?? 0, gate: c.gate ?? 0.5, pattern: c.pattern, ...(v.auto ? { auto: true, name: String(v.name || '') } : {}) };
    }
    store.set('banks', banks);
  }
  if (x.sel && x.sel.g === 'A' && x.sel.n >= 0 && x.sel.n < 8) sel = { g: 'A', n: x.sel.n | 0 }; else sel = { g: 'A', n: 0 };
  store.set('bankSel', sel);
  chain = Array.isArray(x.chain) ? x.chain.filter(k => SLOT_RE.test(k)) : [];
  store.set('chain', chain); playingSlot = '';
  const c = cleanSettings(banks[slotKey(sel.g, sel.n)]);
  state.pattern = c.pattern || blankPattern(); state.shuffle = c.shuffle ?? 0; state.gate = c.gate ?? 0.5;
  tail = []; sendGroove(); renderSeq(); pushPattern(); renderBank(); saveSession();
}
// factory presets: whole projects from factory-presets.json (build.js puts the file here; the old list is in git history before v42)
const PROJECT_BUILTIN = /*@factory*/{};
const prjBar = presetBar('prj', 'projectPresets', PROJECT_BUILTIN, projectSnap, applyPreset, (taken) => NAMER(taken));
// an older settings file from the 303 app can hold separate sound and pattern lists: fold them into the one list
// (once each, by name). Returns how many were added.
function foldPresets(sounds, patterns) {
  const done = new Set(store.get('folded', [])); let n = 0;
  const fold = (src, kind) => { for (const [name, x] of Object.entries(src || {})) {
    const id = kind + ':' + name; if (done.has(id)) continue; done.add(id);
    let nm = name; for (let i = 2; nm in prjBar.user; i++) nm = `${name.slice(0, 34)} (${i})`;
    prjBar.user[nm] = { kind, [kind]: x }; n++;
  } };
  fold(sounds, 'sound'); fold(patterns, 'pattern');
  store.set('folded', [...done]); if (n) { prjBar.save(); prjBar.render(''); }
  return n;
}
const download = (name, obj) => {
  if (tbPlugin) { tbPlugin.send({ type: 'save', name, text: JSON.stringify(obj, null, 2) }); return; } // the plug-in asks where to save it
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// Export all: every saved preset in one file (Import file adds them all back); with none saved yet, the current project
document.getElementById('prj-export').onclick = () => {
  const c = Object.keys(prjBar.user).length;
  if (!c) {
    const nm = (document.getElementById('prj-name').value.trim() || 'fm-acid-preset').replace(/[^\w .-]+/g, '_');
    download(nm + '.json', { app: 'fm-acid', kind: 'project', version: 1, project: projectSnap() });
    prjBar.say(`No saved presets yet, so exported the current one as ${nm}.json.`); return;
  }
  download('fm-acid-presets.json', { app: 'fm-acid', kind: 'presets', version: 1, projectPresets: prjBar.user });
  prjBar.say(`Exported all ${c} preset${c === 1 ? '' : 's'} to fm-acid-presets.json.`);
};
// Export favourites: every starred preset (factory and own) in the Export all format
document.getElementById('prj-exfav').onclick = () => {
  const out = {};
  for (const v of store.get('fav.prj', [])) {
    const nm = v.slice(2), x = v[0] === 'u' ? prjBar.user[nm] : PROJECT_BUILTIN[nm];
    if (x && !(nm in out)) out[nm] = x;
  }
  const c = Object.keys(out).length;
  if (!c) { prjBar.say('No favourites yet. Tap ☆ on a preset to add it.'); return; }
  download('fm-acid-favourites.json', { app: 'fm-acid', kind: 'presets', version: 1, projectPresets: out });
  prjBar.say(`Exported ${c} favourite${c === 1 ? '' : 's'} to fm-acid-favourites.json.`);
};
// Import file (Preset menu) and Import (Options › File) take any file this page has exported: one project, a presets
// file (Export all, favourites), or an older settings file with separate sound and pattern lists
const soundPick = (c) => ({ knobs: c.knobs, fm: c.fm, ...(c.tune && { tune: c.tune }), fx: c.fx });
const patternPick = (c) => ({ bpm: c.bpm, shuffle: c.shuffle, gate: c.gate, pattern: c.pattern });
const legacyList = (src, pick) => Object.fromEntries(src && typeof src === 'object' ? Object.entries(src)
  .map(([n, x]) => [n.trim().slice(0, 40), pick(cleanSettings(x))]).filter(([n]) => n) : []);
async function importFile(f) {
  try {
    const j = JSON.parse(await f.text());
    if (!j || typeof j !== 'object') throw 0;
    const x = j.project || j.current?.project;
    if (j.kind !== 'presets' && x && typeof x === 'object') {
      applyProject(x);
      const nm = f.name.replace(/\.json$/i, '').trim().slice(0, 40) || 'Imported';
      prjBar.user[nm] = projectSnap(); prjBar.save(); prjBar.render('u:' + nm);
      prjBar.say(`Loaded and saved as ${nm}.`); return;
    }
    let n = 0;
    if (j.projectPresets && typeof j.projectPresets === 'object') {
      for (const [k, v] of Object.entries(j.projectPresets)) { const nm = k.trim().slice(0, 40); if (nm && v && typeof v === 'object') { prjBar.user[nm] = v; n++; } }
      prjBar.save(); prjBar.render('');
    }
    // older settings files: separate sound and pattern lists (version 2), or one combined list (version 1)
    const withPat = j.presets && typeof j.presets === 'object' ? Object.fromEntries(Object.entries(j.presets).filter(([, p]) => Array.isArray(p?.pattern))) : null;
    n += foldPresets({ ...legacyList(j.soundPresets, soundPick), ...legacyList(j.presets, c => ({ knobs: c.knobs, fm: c.fm })) },
      { ...legacyList(j.patternPresets, patternPick), ...legacyList(withPat, patternPick) });
    const cur = j.current; let applied = false;
    if (cur?.sound || cur?.pattern) { if (cur.sound) applySound(cur.sound); if (cur.pattern) applyPattern(cur.pattern); applied = true; }
    else if (cur && typeof cur === 'object') { applySound(cur); applyPattern(cur); applied = true; }
    if (!n && !applied && !j.projectPresets) throw 0;
    prjBar.say(`Added ${n} preset${n === 1 ? '' : 's'}${applied ? ', and applied the saved sound and pattern' : ''}.`);
  } catch { prjBar.say('That file is not a preset export from this page.'); }
}
for (const [btn, input] of [['prj-import', 'prj-file']]) {
  const el = document.getElementById(input);
  document.getElementById(btn).onclick = () => el.click();
  el.addEventListener('change', () => { const f = el.files[0]; el.value = ''; if (f) importFile(f); });
}
for (const el of document.querySelectorAll('.pm')) presetMenu(el);
document.getElementById('prj-roll').onclick = () => prjBar.suggest(true);
document.querySelector('#prj-bar .pm-btn')?.addEventListener('click', () => prjBar.suggest(false));

for (const k of KNOBS) drawKnob(k.id);
drawFmAll(); drawBpm();
