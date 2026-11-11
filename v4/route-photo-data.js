// Exact step matching: photographed direction and floor are never inferred from icon alone.
const RoutePhotoModel = (() => {
  const X = '5남의 동쪽과 서쪽을 이어주는 계단';
  const frames = new Map(Object.values(FIELD_GUIDES).flatMap(g => [...g.photos, ...g.references]).map(p => [p.id, p]));
  const xStep = st => (st.ids || []).some(id => id.startsWith(X + '|'));
  const exactUp = st => st && st.from === 1 && st.f === 2 && st.ids[0] === X + '|1' && st.ids.at(-1) === X + '|2';
  const floor = f => f === 0 ? t('floor_b1') : t('floor', { f });
  const field = id => ({ id, src: `../img/field/IMG_${id}.jpg`,
    get title() { return t(`photo.${id}.title`); },
    get caption() { return this.title; } });
  function describe(st, index, steps) {
    if (st.fieldPhoto) {
      const cue = { '0844': t('photo.south_cue_entry'), '0845': t('photo.south_cue_right'),
        '0846': t('photo.south_cue_down'), '0847': t('photo.south_cue_mid'), '0850': t('photo.south_cue_arrive') }[st.fieldPhoto];
      return { frames: [frames.get(st.fieldPhoto)], title: t('photo.south_title'), cue,
        references: FIELD_GUIDES.south.references, stair: ['0845', '0846', '0847'].includes(st.fieldPhoto) };
    }
    if (exactUp(st)) return { frames: [frames.get('0854')], title: t('photo.x_up_title'),
      cue: t('photo.x_up_cue'), stair: true, compare: 'xstairs', references: FIELD_GUIDES.xstairs.references };
    if (st.icon === 'x' && st.f === 2 && exactUp(steps[index - 1])) return {
      frames: [frames.get('0855')], title: t('photo.landing_title'), cue: t('photo.landing_cue'),
      stair: true, compare: 'xstairs', references: FIELD_GUIDES.xstairs.references };
    if (xStep(st)) return { frames: [], title: t('photo.x_direction'), stair: true, compare: 'xstairs',
      cue: st.from === undefined ? t('photo.same_floor_cue', { floor: floor(st.f) }) : `${st.f > st.from ? '↑' : '↓'} ${floor(st.from)} → ${floor(st.f)}`,
      note: st.from === undefined ? t('photo.x_same_note') : t('photo.missing_direction') };
    const eastBasement = (st.ids || []).find(id => id === 'B1:north' || id === 'B1:south');
    if (st.from === 1 && st.f === 0 && eastBasement) {
      const north = eastBasement === 'B1:north';
      return { title: t('photo.east_down_title'), cue: t('photo.east_down_cue'), stair: true,
        frames: north ? [field('0882')]
          : [field('0840'), field('0842')] };
    }
    if (st.from === 0 && st.f === 1 && eastBasement) return {
      title: t('photo.east_up_title'), cue: t('photo.east_up_cue'), stair: true, frames: [], suppressFallback: true,
      note: t('photo.missing_up') };
    if (st.f === 0 && st.from === undefined && st.icon === 'straight' && /^B1:(north|south)$/.test(st.ids?.[0])) {
      const north = st.ids[0] === 'B1:north';
      return { title: t('photo.east_corridor_title'), cue: t('photo.east_corridor_cue'), frames: [north
        ? field('0885')
        : field('0843')] };
    }
    if (st.from !== undefined && !st.lift) return { frames: [], title: t('photo.stair_direction'), stair: true,
      cue: `${st.f > st.from ? '↑' : '↓'} ${floor(st.from)} → ${floor(st.f)}`,
      note: t('photo.check_floor') };
    return null;
  }
  return { describe };
})();
