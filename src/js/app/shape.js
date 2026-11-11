// ---------- Shape page ----------
// Everything around the operators: pitch envelope, click, noise, the filter's extras, the amp envelope, the bit
// crusher, the LFO and what velocity (the Accent dial) does. Blocks laid out like the FX page.
{
  const host = document.getElementById('shape');
  const blk = (id, name, sub = '') => `<section class="fxb on" id="sh-${id}" aria-label="${name}"><div class="fxh"><span class="fxname">${name}</span>${sub ? `<span class="fxsub">${sub}</span>` : ''}</div><div class="fxknobs"></div></section>`;
  host.innerHTML = `<div class="sh-row">${blk('pitch', 'Pitch env')}${blk('click', 'Click')}${blk('noise', 'Noise')}${blk('crush', 'Crush')}</div>`
    + `<div class="sh-row">${blk('filt', 'Filter')}${blk('amp', 'Amp')}${blk('vel', 'Velocity', 'what Accent does')}</div>`
    + `<div class="sh-row">${blk('lfo', 'LFO')}</div>`;
  const B = (id) => { const s = document.getElementById('sh-' + id); return [s.querySelector('.fxh'), s.querySelector('.fxknobs')]; };
  const dials = (id, list) => { const k = B(id)[1]; for (const [p, name] of list) fmDial(p, k, name); };
  dials('pitch', [['pAmt', 'Amount'], ['pDec', 'Decay']]);
  fmSeg('clkType', B('click')[0], FM_CLICK_TYPES, 'Click type'); dials('click', [['clk', 'Level'], ['clkDec', 'Decay']]);
  fmSeg('nType', B('noise')[0], FM_NOISE_TYPES, 'Noise filter'); dials('noise', [['nLvl', 'Level'], ['nCut', 'Cutoff'], ['nRes', 'Reso'], ['nAtk', 'Attack'], ['nDec', 'Decay']]);
  dials('crush', [['bits', 'Bits'], ['srDiv', 'Rate']]);
  fmSeg('fType', B('filt')[0], FM_FILTER_TYPES, 'Filter type'); dials('filt', [['fDrive', 'Drive'], ['kTrack', 'Key track'], ['slide', 'Slide time']]);
  dials('amp', [['aAtk', 'Attack'], ['aHold', 'Hold'], ['aDec', 'Decay'], ['aSus', 'Sustain'], ['aRel', 'Release'], ['aCurve', 'Curve']]);
  dials('vel', [['vLvl', 'Level'], ['vPitch', 'Pitch'], ['vFm', 'FM'], ['vFilt', 'Filter']]);
  // LFO: shape, rate, amount, two destinations, retrigger. The voice is mono, so fm/dm's pan destination is left out.
  const [lh, lk] = B('lfo');
  fmSeg('lShape', lh, FM_LFO_SHAPES, 'LFO shape');
  fmDial('lRate', lk, 'Rate'); fmDial('lDepth', lk, 'Amount');
  const DESTS = FM_LFO_DESTS.map((n, i) => [i, n]).filter(([, n]) => n !== 'pan');
  for (const [id, label] of [['lDest', 'to'], ['lDest2', 'and to']]) {
    lh.insertAdjacentHTML('beforeend', `<span class="fxsub">${label}</span><div class="fn rmenu tmenu" data-label="LFO destination (${label})"></div>`);
    const el = lh.lastElementChild;
    typeMenu(el, DESTS.map(([, n]) => ({ name: n, tip: n })), (i) => setFm(id, DESTS[i][0]));
    (fmSync[id] ||= []).push(() => drawTypeMenu(el, Math.max(0, DESTS.findIndex(([i]) => i === Math.round(state.fm[id])))));
  }
  fmSwitch('lRetrig', lh, 'Retrig');
}
