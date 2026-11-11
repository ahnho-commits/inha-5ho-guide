'use strict';
const LanguageUI = (() => {
  const toggle = document.getElementById('language-toggle');
  const panel = document.getElementById('language-panel');
  const options = document.getElementById('language-options');
  let previousFocus, layoutFrame = 0;
  options.innerHTML = LANGUAGES.map(({ code, name }) => `<button type="button" data-language="${code}" lang="${code}" aria-pressed="${code === LANG}"><span>${name}</span><span class="language-check" aria-hidden="true">✓</span></button>`).join('');
  function staticText() {
    document.documentElement.lang = LANG;
    document.title = t('ui.title');
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    for (const [attr, data] of [['aria-label', 'i18nAria'], ['placeholder', 'i18nPlaceholder']]) {
      document.querySelectorAll(`[data-${data.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}]`).forEach(el => el.setAttribute(attr, t(el.dataset[data])));
    }
    options.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === LANG)));
    document.getElementById('language-current').textContent = LANGUAGES.find(item => item.code === LANG).name;
  }
  function layout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--credit-space', Math.ceil(document.querySelector('.credit').getBoundingClientRect().height + 14) + 'px');
      const bottom = Math.max(document.querySelector('.top').getBoundingClientRect().bottom, document.querySelector('.language-bar').getBoundingClientRect().bottom);
      const sheet = document.querySelector('.sheet:not([hidden])');
      if (sheet?.id === 's-indoor' && typeof RouteSheet !== 'undefined') {
        RouteSheet.measure();
      } else if (sheet) {
        const mapSpace = sheet.id === 's-start' ? (innerHeight <= 500 ? 100 : 180) : 84;
        sheet.style.maxHeight = Math.max(120, Math.min(innerHeight * .78, innerHeight - bottom - mapSpace)) + 'px';
      }
      placeFabs();
      if (phase === 'indoor' && plan) fitScreen(Indoor.viewBounds(plan, inStep), 24, 80);
      else if (!route) overview();
      else draw();
    });
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (previousFocus?.isConnected) previousFocus.focus();
    else toggle.focus();
  }
  function open() {
    previousFocus = document.activeElement;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    options.querySelector(`[data-language="${LANG}"]`).focus();
  }
  function setLanguage(code) {
    if (!LANGUAGES.some(item => item.code === code) || !STR[code]) return false;
    LANG = code;
    measuredText.clear();
    staticText();
    refreshAppLanguage();
    FieldPhotoViewer.refreshLanguage();
    layout();
    return true;
  }
  toggle.onclick = () => panel.hidden ? open() : close();
  document.getElementById('language-close').onclick = close;
  options.onclick = event => {
    const button = event.target.closest('[data-language]');
    if (!button) return;
    close();
    setLanguage(button.dataset.language);
  };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...panel.querySelectorAll('button')], first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) close();
  });
  window.addEventListener('resize', layout);
  document.querySelector('.indoor-data-note').addEventListener('toggle', layout);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(layout);
    observer.observe(document.querySelector('.top'));
    document.querySelectorAll('.sheet').forEach(el => observer.observe(el));
  }
  if (document.fonts) {
    const fontsReady = () => { measuredText.clear(); layout(); };
    document.fonts.ready.then(fontsReady);
    document.fonts.addEventListener('loadingdone', fontsReady);
  }
  staticText();
  layout();
  return { setLanguage, layout };
})();
