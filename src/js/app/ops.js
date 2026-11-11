// ---------- Operators page ----------
// Four columns, one per operator: Ratio, Level, Attack, Decay and a Fixed switch (a fixed operator stays at its own
// frequency whatever note plays, and its Ratio dial reads in Hz). Under them the algorithm as a block diagram, then
// the controls that act on all four.
{
  const host = document.getElementById('ops');
  host.innerHTML = OPS.map(o => `<section class="fxb opb on" aria-label="Operator ${o}"><div class="fxh"><span class="fxname opname">${o}</span><span class="fxsub" id="op-role-${o}"></span></div><div class="fxknobs" id="op-${o}"></div></section>`).join('')
    + `<section class="fxb on blk-algo" aria-label="Algorithm"><div class="fxh"><span class="fxname">Algorithm</span><span class="fxsub" id="algo-name"></span></div><svg class="route-dia algo-dia" id="algo-dia" viewBox="0 0 250 104" role="img"></svg></section>`
    + `<section class="fxb on blk-all" aria-label="All operators"><div class="fxh"><span class="fxname">All operators</span></div><div class="fxknobs" id="op-all"></div></section>`;
  for (const o of OPS) {
    const k = document.getElementById('op-' + o), head = k.previousElementSibling;
    fmDial('r' + o, k, 'Ratio'); fmDial('l' + o, k, 'Level'); fmDial('a' + o, k, 'Attack'); fmDial('d' + o, k, 'Decay');
    fmSwitch('fx' + o, head, 'Fixed');
    (fmSync['fx' + o] ||= []).push(() => { for (const e of fmEls['r' + o]) { e.name.textContent = state.fm['fx' + o] >= 0.5 ? 'Freq' : 'Ratio'; e.val.textContent = fmText('r' + o, fmHeard('r' + o)); } });
  }
  const all = document.getElementById('op-all');
  fmDial('fmEnd', all, 'FM end'); fmDial('drift', all, 'Drift'); fmDial('fmNoise', all, 'FM noise'); fmDial('hum', all, 'Humanise');
  fmSwitch('phase', all.previousElementSibling, '90° start');
}
// The algorithm: carriers (the operators you hear) on the bottom row, each modulator above what it modulates, a line
// from every modulator down into its target. Drawn like the FX page's routing diagram; only the carriers are filled.
// The same tables as the voice (FM_ALG_MOD, FM_ALG_CAR in fm-voice.js): bit j of FM_ALG_MOD[a][o] = operator j modulates o.
function drawAlgo() {
  const svg = document.getElementById('algo-dia'); if (!svg) return;
  const a = Math.round(state.fm.algo), mods = FM_ALG_MOD[a], car = FM_ALG_CAR[a];
  const isCar = (o) => (car >> o) & 1, tg = (j) => [0, 1, 2, 3].filter(o => (mods[o] >> j) & 1); // what operator j modulates
  // rows: a carrier sits on row 0; a modulator one row above the highest thing it modulates
  const row = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) if (!isCar(j)) row[j] = 1 + Math.max(0, ...tg(j).map(o => row[o]));
  // columns: carriers left to right; a modulator over the middle of its targets, moved right if that spot is taken
  const col = [0, 0, 0, 0], taken = new Set(); let c = 0;
  for (let o = 0; o < 4; o++) if (isCar(o)) { col[o] = c++; taken.add('0:' + col[o]); }
  for (let j = 0; j < 4; j++) if (!isCar(j)) {
    const t = tg(j); let x = t.length ? t.reduce((s, o) => s + col[o], 0) / t.length : c++;
    while (taken.has(row[j] + ':' + x)) x += 1;
    col[j] = x; taken.add(row[j] + ':' + x);
  }
  const W = 34, H = 20, GX = 54, GY = 28, rows = Math.max(...row) + 1, cols = Math.max(...col) + 1;
  const x0 = (250 - ((cols - 1) * GX + W)) / 2, y0 = 104 - 14 - H - (4 - rows) * GY / 2;
  const X = (o) => x0 + col[o] * GX, Y = (o) => y0 - row[o] * GY;
  let h = '';
  for (let j = 0; j < 4; j++) for (const o of tg(j)) { // modulator j into operator o
    const xa = X(j) + W / 2, ya = Y(j) + H, xb = X(o) + W / 2, yb = Y(o), ym = (ya + yb) / 2;
    h += `<polyline class="rw" points="${xa},${ya} ${xa},${ym} ${xb},${ym} ${xb},${yb - 5}"/><path class="ra" d="M${xb - 3.5} ${yb - 5} L${xb} ${yb} L${xb + 3.5} ${yb - 5}Z"/>`;
  }
  if (state.fm.fb !== 0) { const x = X(3), y = Y(3); h += `<path class="rw" d="M${x + W} ${y + H / 2} h8 v${-H / 2 - 7} h${-W / 2 - 8} v2"/><path class="ra" d="M${x + W / 2 - 3.5} ${y - 5} L${x + W / 2} ${y} L${x + W / 2 + 3.5} ${y - 5}Z"/>`; } // D feeds back into itself
  for (let o = 0; o < 4; o++) {
    h += `<g class="rb on${isCar(o) ? ' car' : ''}"><rect x="${X(o)}" y="${Y(o)}" width="${W}" height="${H}" rx="2"/><text x="${X(o) + W / 2}" y="${Y(o) + H / 2 + 5}">${OPS[o].toLowerCase()}</text></g>`;
    if (isCar(o)) h += `<polyline class="rw" points="${X(o) + W / 2},${Y(o) + H} ${X(o) + W / 2},${Y(o) + H + 8}"/>`;
  }
  const cs = [0, 1, 2, 3].filter(isCar);
  h += `<polyline class="rw" points="${X(cs[0]) + W / 2},${y0 + H + 8} ${X(cs[cs.length - 1]) + W / 2 + (cs.length > 1 ? 0 : 0.01)},${y0 + H + 8}"/>`;
  svg.innerHTML = h;
  svg.setAttribute('aria-label', `Algorithm ${a + 1}: ${FM_ALGOS[a]}. Carriers ${cs.map(o => OPS[o]).join(', ')}.`);
  document.getElementById('algo-name').textContent = (a + 1) + ' · ' + FM_ALGOS[a];
  for (let o = 0; o < 4; o++) { const r = document.getElementById('op-role-' + OPS[o]); if (r) r.textContent = isCar(o) ? 'carrier' : tg(o).length ? 'into ' + tg(o).map(t => OPS[t].toLowerCase()).join(' ') : 'unused'; }
}
(fmSync.algo ||= []).push(drawAlgo); (fmSync.fb ||= []).push(drawAlgo);
