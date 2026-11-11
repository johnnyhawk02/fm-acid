// Builds the install icons in icons/ from one SVG design: the app's segmented dial in grey-LCD ink with the orange
// stop-button square in the middle (the grey + colour look's one accent). Run: node tools/make-icons.js (needs Playwright).
//   icon.svg / icon-192 / icon-512: rounded dark bezel round a grey glass, transparent corners (favicon, desktop, "any")
//   maskable-512 / apple-touch-icon: full-bleed glass, dial inside the 80% safe circle (Android masks, iOS rounds itself)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const GLASS = '#d3d6cc', GLASS_HI = '#e6e8df', GLASS_LO = '#bfc2b7', INK = '#121410', BEZEL = '#1d1e1b', ACCENT = '#d0600a';
const SEGS = 24, A0 = -150, SWEEP = 300, LIT = 17;

function dial(cx, cy, ro, ri, gapDeg) {
  const pt = (deg, r) => { const t = (deg - 90) * Math.PI / 180; return `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`; };
  const seg = (i) => {
    const w = SWEEP / SEGS, a0 = A0 + i * w + gapDeg / 2, a1 = A0 + (i + 1) * w - gapDeg / 2;
    return `M${pt(a0, ro)}A${ro} ${ro} 0 0 1 ${pt(a1, ro)}L${pt(a1, ri)}A${ri} ${ri} 0 0 0 ${pt(a0, ri)}Z`;
  };
  const all = Array.from({ length: SEGS }, (_, i) => seg(i));
  const sq = ri * 0.78;
  return `<path d="${all.slice(LIT).join('')}" fill="${INK}" fill-opacity=".13"/>
  <path d="${all.slice(0, LIT).join('')}" fill="${INK}" transform="translate(${ro * 0.025} ${ro * 0.025})" fill-opacity=".17"/>
  <path d="${all.slice(0, LIT).join('')}" fill="${INK}"/>
  <rect x="${cx - sq / 2}" y="${cy - sq / 2}" width="${sq}" height="${sq}" rx="${sq * 0.12}" fill="${ACCENT}"/>`;
}

const glassFill = `<defs><radialGradient id="g" cx="30%" cy="24%" r="95%">
  <stop offset="0" stop-color="${GLASS_HI}"/><stop offset=".55" stop-color="${GLASS}"/><stop offset="1" stop-color="${GLASS_LO}"/></radialGradient></defs>`;

// framed: bezel and glass, for "any" icons and the favicon
const framed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glassFill}
  <rect width="512" height="512" rx="112" fill="${BEZEL}"/>
  <rect x="24" y="24" width="464" height="464" rx="90" fill="url(#g)"/>
  ${dial(256, 262, 176, 106, 4.2)}
</svg>`;

// full bleed: glass to the edges, dial within the safe zone
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glassFill}
  <rect width="512" height="512" fill="url(#g)"/>
  ${dial(256, 262, 156, 94, 4.2)}
</svg>`;

(async () => {
  const dir = path.join(__dirname, '..', 'icons');
  fs.writeFileSync(path.join(dir, 'icon.svg'), framed + '\n');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (svg, size, file, transparent) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(dir, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await shot(framed, 192, 'icon-192.png', true);
  await shot(framed, 512, 'icon-512.png', true);
  await shot(bleed, 512, 'maskable-512.png', false);
  await shot(bleed, 180, 'apple-touch-icon.png', false);
  await browser.close();
})();
