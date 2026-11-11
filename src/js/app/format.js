// ---------- engineering notation ----------
const PFX = [[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p']];
function fmt(v, unit) {
  if (unit === '×' || unit === 'Hz') return +v.toPrecision(4) + ' ' + unit;
  if (unit === '%') return Math.round(v * 100) + ' %';
  if (unit === 'V') return +v.toPrecision(4) + ' V';
  for (const [m, p] of PFX) if (Math.abs(v) >= m * 0.9999) return +(v / m).toPrecision(3) + ' ' + p + unit;
  return v.toExponential(2) + ' ' + unit;
}

