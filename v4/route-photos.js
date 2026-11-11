// The existing Next/Previous route step controls this card; indoor GPS is not used to guess floors.
const RoutePhotos = (() => {
  const el = id => document.getElementById(id);
  const panel = el('step-photo');
  let current, lastStep;
  function render(st, index, steps) {
    lastStep = [st, index, steps];
    const match = RoutePhotoModel.describe(st, index, steps);
    const fallback = st.photo && !match?.suppressFallback ? FieldPhotoViewer.routeFrames() : [];
    const photos = match?.frames.length ? match.frames : fallback;
    current = { ...match, frames: photos, title: match?.title || t('photo.current_title') };
    panel.hidden = !photos.length && !match;
    if (panel.hidden) return;
    el('step-photo-cue').textContent = match?.cue || t('photo.current_cue');
    el('step-photo-image').hidden = !photos.length;
    el('step-photo-caption').textContent = photos.length ? photos[0].title || photos[0].caption : match.note;
    if (photos.length) el('step-photo-image').src = FieldPhotoViewer.thumbnail(photos[0].src);
    else el('step-photo-image').removeAttribute('src');
    el('step-photo-image').alt = photos.length ? [photos[0].title, photos[0].caption].filter(Boolean).join(' · ') : '';
    el('step-photo-open').hidden = !photos.length;
    el('step-photo-open').textContent = photos.length > 1 ? t('photo.open_count', { n: photos.length }) : t('photo.open');
    el('step-photo-compare').hidden = !match?.compare;
    el('step-photo-compare').textContent = t('photo.compare');
    el('step-photo-schematic').textContent = t('photo.schematic');
    el('step-photo-schematic').hidden = !match?.stair;
    // Show the actual photo inline; the old small thumbnail remains for outdoor instructions.
    if (photos.length) {
      el('i-photo').hidden = true;
      el('instr').classList.remove('photo');
    }
  }
  el('step-photo-open').onclick = () => FieldPhotoViewer.openStep(current);
  el('step-photo-image').onclick = () => FieldPhotoViewer.openStep(current);
  el('step-photo-compare').onclick = () => FieldPhotoViewer.openGuide(current.compare);
  return { render, currentSpec: () => current, refreshLanguage: () => { if (lastStep) render(...lastStep); } };
})();
