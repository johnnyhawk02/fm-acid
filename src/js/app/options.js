// ---------- options sheet ----------
const optDlg = document.getElementById('options');
document.getElementById('open-options').onclick = () => { if (optDlg.showModal) optDlg.showModal(); else optDlg.setAttribute('open', ''); };
document.getElementById('close-options').onclick = () => { if (optDlg.close) optDlg.close(); else optDlg.removeAttribute('open'); };
optDlg.addEventListener('click', (e) => { if (e.target === optDlg) optDlg.close(); });
const otabs = document.getElementById('otabs');
function showSec(k, focus) {
  for (const b of otabs.querySelectorAll('[role=tab]')) { const on = b.dataset.sec === k; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
  for (const sec of optDlg.querySelectorAll('.osec')) sec.hidden = sec.id !== 'osec-' + k;
  optDlg.querySelector('.opt-body').scrollTop = 0; store.set('optTab', k);
}
otabs.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) showSec(b.dataset.sec, true); });
otabs.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]; if (!d) return;
  const t = [...otabs.querySelectorAll('[role=tab]')], i = t.findIndex(b => b.getAttribute('aria-selected') === 'true');
  showSec(t[(i + d + t.length) % t.length].dataset.sec, true); e.preventDefault();
});
showSec(document.getElementById('osec-' + store.get('optTab', 'midi')) ? store.get('optTab', 'midi') : 'midi');

// ---------- Options › Colours: the LCD's glass and ink. Each theme is a set of colour tokens in lcd.css ([data-lcd=…]);
// orange is the default. The choice is saved and put on <html> by a line in the page head before the styles, so it never flashes ----------
(() => {
  const THEMES = [['orange', 'Orange'], ['amber', 'Amber'], ['lime', 'Lime'], ['blue', 'Blue'], ['red', 'Red'], ['grey', 'Grey']];
  const box = document.getElementById('lcd-swatches'), root = document.documentElement;
  const cur = () => THEMES.some(([k]) => k === root.dataset.lcd) ? root.dataset.lcd : 'orange';
  const mark = () => { for (const b of box.children) { const on = b.dataset.lcd === cur(); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; } };
  const pick = (k, focus) => {
    if (k === 'orange') delete root.dataset.lcd; else root.dataset.lcd = k;
    store.set('lcdTheme', k); mark(); applyLook(); if (focus) box.querySelector(`[data-lcd="${k}"]`).focus();
  };

  // Brightness, saturation, dirt, grain: saved as tb303.lcdLook (the slider values) and tb303.lcdVars (the CSS
  // variables they make, which the page head puts back before the styles load). At the stock values nothing is set at all.
  // Dirt starts at 0 (Johnny, 2026-11-05); a look saved before that had dirt 100 as its stock value, so it is reset once
  // Glow was removed (Johnny, 2026-11-05: fixed at 0); a saved look's glow value is dropped and its --glow variable cleared
  const LOOK0 = { bright: 0, sat: 100, dirt: 0, grain: 100 };
  const look = { ...LOOK0, ...store.get('lcdLook', {}) };
  delete look.glow;
  const VARS = ['--glass', '--panel-rgb', '--dirt', '--grain', '--glow'];
  const hex2hsl = (h) => {
    const n = parseInt(h.replace('#', ''), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hh * 60, s, l];
  };
  const hsl2rgb = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map(v => Math.round((v + m) * 255));
  };
  function applyLook() {
    for (const v of VARS) root.style.removeProperty(v);
    const vars = {};
    if (look.bright !== 0 || look.sat !== 100) {
      const [h, s0, l0] = hex2hsl(getComputedStyle(root).getPropertyValue('--glass').trim());
      const b = look.bright / 100, s = Math.min(1, s0 * look.sat / 100), l = b > 0 ? l0 + (1 - l0) * b * .8 : l0 * (1 + b * .8);
      const rgb = hsl2rgb(h, s, l);
      vars['--glass'] = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''); vars['--panel-rgb'] = rgb.join(' ');
    }
    for (const k of ['dirt', 'grain']) if (look[k] !== LOOK0[k]) vars['--' + k] = String(look[k] / 100);
    for (const k in vars) root.style.setProperty(k, vars[k]);
    store.set('lcdLook', look); store.set('lcdVars', vars);
  }
  if (!store.get('lcdLookV', 0)) { look.dirt = 0; store.set('lcdLookV', 2); }
  if (store.get('lcdLookV', 0) < 3) { store.set('lcdLookV', 3); applyLook(); }  // drops glow from saved looks (VARS still clears --glow)
  const lookBox = document.getElementById('lcd-look');
  const show = () => { for (const i of lookBox.querySelectorAll('input')) { const k = i.dataset.look; i.value = look[k]; i.nextElementSibling.textContent = k === 'bright' ? (look[k] > 0 ? '+' : '') + look[k] : look[k] + '%'; i.dispatchEvent(new Event('input', { bubbles: true })); } };
  lookBox.addEventListener('input', (e) => { const i = e.target; if (!i.dataset?.look || !e.isTrusted) return; look[i.dataset.look] = +i.value; applyLook(); show(); });
  document.getElementById('lcd-look-reset').onclick = () => { Object.assign(look, LOOK0); applyLook(); show(); };
  show();
  for (const [k, name] of THEMES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.dataset.lcd = k; b.setAttribute('role', 'radio');
    b.innerHTML = `<span>${name}</span><i class="bars" aria-hidden="true"></i>`;
    box.append(b);
  }
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-lcd]'); if (b) pick(b.dataset.lcd); });
  box.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[e.key]; if (!d) return;
    const i = THEMES.findIndex(([k]) => k === cur());
    pick(THEMES[(i + d + THEMES.length) % THEMES.length][0], true); e.preventDefault(); e.stopPropagation();
  });
  mark();

  // Mono / Grey + colour: Mono is the chosen theme as one ink on one glass; Grey + colour (the default) lays the grey glass
  // under it and uses the chosen theme as the one accent colour (lcd.css, [data-lcdmode=colour]). Saved as tb303.lcdMode
  const modeBox = document.getElementById('lcd-mode');
  const markMode = () => { for (const b of modeBox.children) b.setAttribute('aria-pressed', b.dataset.mode === (root.dataset.lcdmode === 'colour' ? 'colour' : 'mono')); };
  const setMode = (m) => { if (m === 'colour') root.dataset.lcdmode = 'colour'; else delete root.dataset.lcdmode; store.set('lcdMode', m); markMode(); applyLook(); };
  modeBox.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
  markMode();
})();
