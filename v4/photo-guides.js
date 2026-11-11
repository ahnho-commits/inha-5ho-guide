// User-confirmed locations and viewing directions. These albums do not define routes.
const FIELD_GUIDES = (() => {
  const photo = id => ({ id, src: `../img/field/IMG_${id}.jpg`,
    get title() { return t(`photo.${id}.title`); },
    get caption() { return t(`photo.${id}.caption`); } });
  const guide = (key, photos, references) => ({
    get title() { return t(key === 'xstairs' ? 'nav.xstairs' : `photo.guide.${key}.title`); },
    get subtitle() { return t(`photo.guide.${key}.subtitle`); },
    get notice() { return t(`photo.guide.${key}.notice`); },
    photos: photos.map(photo), references: references.map(photo),
  });
  return {
    south: guide('south', ['0844', '0845', '0846', '0847', '0850'], ['0848', '0849']),
    xstairs: guide('xstairs', ['0854', '0853', '0851', '0855'], ['0852', '0856']),
  };
})();
