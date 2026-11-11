/* Field-photo viewer; route calculations and location handling stay outside this module. */
const FieldPhotoViewer = (() => {
  'use strict';
  const field = (number, key) => ({ src: `../img/field/IMG_${String(number).padStart(4, '0')}.jpg`,
    get caption() { return t(key); } });
  const additions = {
    lobby: [field(882, 'photo.legacy.lobby')],
    bnorth: [field(885, 'photo.legacy.bnorth'), field(882, 'photo.legacy.bnorth_before')],
    bsouth: [field(843, 'photo.legacy.bsouth'), field(840, 'photo.legacy.bsouth_before'), field(842, 'photo.legacy.bsouth_mid')],
    towersign: [field(867, 'photo.legacy.towersign'), field(866, 'photo.legacy.tower_landing'), field(868, 'photo.legacy.tower_up')],
  };
  const titleKeys = { lobby: 'photo.album.lobby', bnorth: 'photo.album.bnorth', bsouth: 'photo.album.bsouth', towersign: 'photo.album.tower' };
  const thumb = document.getElementById('i-photo');
  const viewer = document.getElementById('viewer');
  const nativeSetPhoto = setPhoto;
  const thumbnail = src => src.replace('../img/field/', '../img/thumbs/');
  const badge = document.createElement('span');
  badge.className = 'field-photo-count';
  thumb.append(badge);
  viewer.classList.add('field-gallery');
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-labelledby', 'field-title');
  viewer.innerHTML = `<div class="field-bar"><div class="field-heading"><strong id="field-title"></strong><span id="field-context"></span></div><button type="button" id="field-close"></button></div>
    <p class="field-notice" id="field-notice" hidden></p>
    <div class="field-sections" id="field-sections" hidden><button type="button" id="field-scenes" aria-pressed="true"></button><button type="button" id="field-maps" aria-pressed="false"></button></div>
    <img class="field-image" id="field-image" alt="" decoding="async">
    <div class="field-caption" aria-live="polite"><strong id="field-caption-title" hidden></strong><p id="field-caption"></p></div>
    <div class="field-nav"><button type="button" id="field-prev"></button><span class="field-position" id="field-position"></span><button type="button" id="field-next"></button></div>
    <p class="field-hint" id="field-hint"></p>`;
  const el = id => document.getElementById(id);
  let routeAlbum = { key: undefined, photos: [], index: 0 };
  let activeAlbum = null, section = 'photos', referenceIndex = 0, returnFocus;
  // Preserve the guide's translation getters; spreading it would freeze its text.
  const guideAlbums = Object.fromEntries(Object.entries(FIELD_GUIDES).map(([key, guide]) => [key, Object.assign(Object.create(guide), { index: 0 })]));
  const frames = () => activeAlbum[section];
  const currentIndex = () => section === 'references' ? referenceIndex : activeAlbum.index;
  function labels() {
    for (const [id, key] of [['field-close', 'photo.close'], ['field-scenes', 'photo.field'], ['field-maps', 'photo.maps'], ['field-prev', 'photo.previous'], ['field-next', 'photo.next'], ['field-hint', 'photo.hint']]) el(id).textContent = t(key);
    el('field-prev').setAttribute('aria-label', t('photo.previous_label'));
    el('field-next').setAttribute('aria-label', t('photo.next_label'));
  }
  function render() {
    labels();
    const photos = frames(), index = currentIndex(), photo = photos[index];
    const guide = !!activeAlbum.title;
    viewer.classList.toggle('has-guide', guide);
    el('field-image').src = photo.src;
    el('field-image').alt = [photo.title, photo.caption].filter(Boolean).join(' · ');
    el('field-caption-title').hidden = !photo.title;
    el('field-caption-title').textContent = photo.title || '';
    el('field-caption').textContent = photo.caption;
    el('field-position').textContent = `${index + 1} / ${photos.length}${photo.id ? ' · ' + t('photo.number', { n: Number(photo.id) - 800 }) : ''}`;
    el('field-title').textContent = guide ? activeAlbum.title : t('photo.field');
    el('field-context').textContent = guide ? activeAlbum.subtitle : t(titleKeys[activeAlbum.key] || 'photo.surroundings');
    el('field-notice').hidden = !activeAlbum.notice;
    el('field-notice').textContent = activeAlbum.notice || '';
    el('field-sections').hidden = !activeAlbum.references?.length;
    el('field-scenes').setAttribute('aria-pressed', String(section === 'photos'));
    el('field-maps').setAttribute('aria-pressed', String(section === 'references'));
    el('field-prev').hidden = el('field-next').hidden = photos.length < 2;
  }
  function open(album) {
    if (!album.photos.length) return;
    returnFocus = document.activeElement;
    activeAlbum = album; section = 'photos'; referenceIndex = 0;
    render(); viewer.hidden = false; viewer.scrollTop = 0; el('field-close').focus();
  }
  function close() {
    viewer.hidden = true;
    if (returnFocus && returnFocus.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus();
    else document.querySelector('.sheet:not([hidden]) button:not([disabled])')?.focus();
    activeAlbum = null;
  }
  function move(amount) {
    const next = (currentIndex() + amount + frames().length) % frames().length;
    if (section === 'references') referenceIndex = next;
    else activeAlbum.index = next;
    render();
  }
  // GPS updates affect only the route thumbnail, never a separate guide album.
  setPhoto = function (key) {
    if (!key || !additions[key]) nativeSetPhoto(key);
    else {
      thumb.hidden = false;
      document.getElementById('instr').classList.add('photo');
      thumb.dataset.photo = key;
    }
    if (key !== routeAlbum.key) {
      if (!viewer.hidden && activeAlbum === routeAlbum) close();
      routeAlbum = { key, photos: [], index: 0 };
    }
    if (!key) { routeAlbum.photos = []; return; }
    const original = { src: `../img/${key}.jpg`,
      get caption() { return t('photo.original', { caption: PHOTOS[key] }); } };
    const photos = [...(additions[key] || []), original];
    routeAlbum.photos = photos;
    const cover = photos[0];
    thumb.firstElementChild.src = thumbnail(cover.src);
    thumb.firstElementChild.alt = cover.caption;
    badge.textContent = t('photo.count', { n: photos.length });
    thumb.setAttribute('aria-label', t('photo.open_label', { n: photos.length }));
  };
  function stepAlbum(spec, index = 0) {
    return { key: 'step', title: spec.title, subtitle: spec.cue || t('photo.current_cue'),
      notice: spec.stair ? t('photo.schematic') : '',
      photos: spec.frames, references: spec.references || [], index };
  }
  function refreshLanguage() {
    labels();
    if (viewer.hidden || !activeAlbum) return;
    if (activeAlbum.key === 'step') {
      const spec = RoutePhotos.currentSpec();
      if (spec?.frames.length) activeAlbum = stepAlbum(spec, Math.min(activeAlbum.index, spec.frames.length - 1));
    }
    // No close/reopen, focus move, section reset, or route/GPS call on a language change.
    render();
  }
  thumb.onclick = () => open(routeAlbum);
  document.querySelectorAll('[data-photo-guide]').forEach(button => {
    button.addEventListener('click', () => open(guideAlbums[button.dataset.photoGuide]));
  });
  viewer.onclick = event => { if (event.target === viewer) close(); };
  el('field-close').onclick = close;
  el('field-prev').onclick = () => move(-1);
  el('field-next').onclick = () => move(1);
  el('field-scenes').onclick = () => { section = 'photos'; render(); };
  el('field-maps').onclick = () => { section = 'references'; render(); };
  viewer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (event.key === 'Tab') {
      const buttons = [...viewer.querySelectorAll('button')].filter(button => !button.closest('[hidden]'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  labels();
  if (thumb.dataset.photo) setPhoto(thumb.dataset.photo);
  return { thumbnail, routeFrames: () => routeAlbum.photos, openGuide: key => open(guideAlbums[key]),
    openStep: spec => open(stepAlbum(spec)), refreshLanguage };
})();
