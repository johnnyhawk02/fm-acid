// ---------- no tooltips, no messages ----------
// Johnny turned tooltips off (v106) and then every status message (v107): nothing pops up or prints at the bottom of the
// screen. Every title attribute on the page becomes data-tip (menus still read it for their key labels), so the
// browser's own tooltip boxes never appear either. The old message spots (#sq-msg, #prj-msg) are hidden in lcd.css.
(() => {
  const strip = () => document.querySelectorAll('body [title]').forEach(el => { if (el.title) el.dataset.tip = el.title; el.removeAttribute('title'); });
  strip(); new MutationObserver(strip).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
})();
