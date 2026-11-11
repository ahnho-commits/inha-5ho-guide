'use strict';
// Presentation state only. These controls never replan a route or start GPS.
const RouteSheet = (() => {
  const el = id => document.getElementById(id);
  const sheet = el('s-indoor'), panel = el('step-photo');
  const toggle = el('route-photo-toggle'), details = el('route-photo-details');
  const infoToggle = el('route-detail-toggle'), more = el('route-more-overlay');
  let expanded = false, infoExpanded = false, stepKey = null, drag = null, ignoreClick = false;
  const isIndoor = () => !sheet.hidden;
  const landscape = () => innerWidth >= 600 && innerHeight <= 500;
  function mapViewport() {
    if (!isIndoor() || !landscape()) return null;
    return { left: sheet.getBoundingClientRect().right + 14, right: innerWidth - 68,
      top: document.querySelector('.language-bar').getBoundingClientRect().bottom + 12, bottom: innerHeight - 28 };
  }
  function layout() { if (typeof LanguageUI !== 'undefined') LanguageUI.layout(); }
  function measure() {
    if (!isIndoor()) return;
    sheet.style.maxHeight = 'none';
    if (!expanded || panel.hidden) return;
    const top = document.querySelector('.top').getBoundingClientRect().bottom;
    const base = sheet.getBoundingClientRect().height - details.getBoundingClientRect().height;
    const mapSpace = landscape() ? 8 : innerHeight < 500 ? 48 : 120;
    const height = Math.max(48, Math.min(innerHeight * .42, innerHeight - top - base - mapSpace));
    const cap = Math.floor(height) + 'px';
    if (details.style.maxHeight !== cap) details.style.maxHeight = cap;
    const photo = el('step-photo-image');
    if (!photo.hidden) {
      const copyHeight = document.querySelector('.step-photo-copy').getBoundingClientRect().height;
      const noteHeight = el('step-photo-schematic').hidden ? 0 : el('step-photo-schematic').getBoundingClientRect().height + 6;
      // Use remaining space for the image before requiring the text area to scroll.
      const photoHeight = Math.floor(Math.max(landscape() ? 60 : 84, Math.min(210, height - copyHeight - noteHeight - 20))) + 'px';
      if (photo.style.height !== photoHeight) photo.style.height = photoHeight;
    }
  }
  function render() {
    const spec = RoutePhotos.currentSpec(), frames = spec?.frames || [];
    const hasPhotos = frames.length > 0;
    toggle.setAttribute('aria-expanded', String(expanded));
    details.hidden = !expanded;
    el('route-photo-label').textContent = t(hasPhotos
      ? (expanded ? 'ui.route_photo_collapse' : 'ui.route_photo_expand')
      : (expanded ? 'ui.route_hide_details' : 'ui.route_details'));
    el('route-photo-count').textContent = hasPhotos ? t('photo.count', { n: frames.length }) : '';
    const thumb = el('route-photo-thumb');
    thumb.hidden = !hasPhotos;
    if (hasPhotos) {
      const src = FieldPhotoViewer.thumbnail(frames[0].src);
      if (thumb.getAttribute('src') !== src) thumb.src = src;
      thumb.alt = [frames[0].title, frames[0].caption].filter(Boolean).join(' · ');
    } else { thumb.removeAttribute('src'); thumb.alt = ''; }
    infoToggle.hidden = !isIndoor();
    infoToggle.setAttribute('aria-expanded', String(infoExpanded));
    infoToggle.firstElementChild.textContent = t(infoExpanded ? 'ui.route_hide_details' : 'ui.route_details');
    infoToggle.lastElementChild.textContent = infoExpanded ? '↑' : '↓';
    el('i-to').hidden = isIndoor() && !infoExpanded;
    measure();
    layout();
  }
  function setExpanded(value) {
    expanded = Boolean(value);
    // Avoid leaving keyboard focus inside a section that has just disappeared.
    if (!expanded && details.contains(document.activeElement)) toggle.focus();
    render();
  }
  function closeMore(restore = true) {
    more.hidden = true;
    el('route-more-toggle').setAttribute('aria-expanded', 'false');
    if (restore && isIndoor()) el('route-more-toggle').focus();
  }
  function sync() {
    const indoor = isIndoor();
    document.body.classList.toggle('indoor-guidance', indoor);
    el('route-more-toggle').hidden = !indoor;
    infoToggle.hidden = !indoor;
    if (!indoor) {
      expanded = false; infoExpanded = false; stepKey = null;
      el('i-to').hidden = false;
      details.hidden = true;
      closeMore(false);
    }
  }
  function onStep(st, index) {
    sync();
    // Language changes rebuild step objects, so identity must not use object reference.
    const key = [index, st.f, st.from, st.kind].join(':');
    if (key !== stepKey) { infoExpanded = false; details.scrollTop = 0; stepKey = key; }
    // Keep the user's photo size preference across steps and language switches.
    render();
  }
  toggle.addEventListener('click', event => {
    if (ignoreClick) { ignoreClick = false; event.preventDefault(); return; }
    setExpanded(!expanded);
  });
  function cancelDrag() { drag = null; toggle.classList.remove('is-dragging'); }
  toggle.addEventListener('pointerdown', event => {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    ignoreClick = false;
    toggle.setPointerCapture?.(event.pointerId);
  });
  toggle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.abs(event.clientY - drag.y) > 8) toggle.classList.add('is-dragging');
  });
  toggle.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dy = event.clientY - drag.y, dx = event.clientX - drag.x;
    const moved = Math.max(Math.abs(dx), Math.abs(dy)) > 8;
    cancelDrag();
    if (moved) {
      ignoreClick = true;
      setTimeout(() => { ignoreClick = false; }, 0);
      if (Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx)) setExpanded(dy < 0);
    }
  });
  toggle.addEventListener('pointercancel', cancelDrag);
  toggle.addEventListener('lostpointercapture', cancelDrag);
  infoToggle.addEventListener('click', () => { infoExpanded = !infoExpanded; render(); });
  el('route-more-toggle').addEventListener('click', () => {
    more.hidden = false;
    el('route-more-toggle').setAttribute('aria-expanded', 'true');
    el('route-more-close').focus();
  });
  el('route-more-close').addEventListener('click', () => closeMore());
  more.addEventListener('click', event => { if (event.target === more) closeMore(); });
  more.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMore(); return; }
    if (event.key !== 'Tab') return;
    const items = [...more.querySelectorAll('button,input,summary')].filter(item => !item.disabled && !item.closest('[hidden]'));
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  sync();
  return { sync, onStep, measure, mapViewport };
})();
