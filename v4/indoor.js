'use strict';
// 5호관 indoor routing on the room graph from indoor-data.js, drawn as a schematic ring per floor.

const Indoor = (() => {
  const NODES = new Map(INDOOR.nodes.map(n => [n.id, n]));
  const ADJ = new Map(INDOOR.nodes.map(n => [n.id, []]));
  for (const [a, b, w, flag] of INDOOR.edges) {
    ADJ.get(a).push([b, w, flag]);
    ADJ.get(b).push([a, w, flag]);
  }
  const X_STAIR = '5남의 동쪽과 서쪽을 이어주는 계단';
  const WING = { '남': 'S', '동': 'E', '서': 'W', '북': 'N', S: 'S', E: 'E', W: 'W', N: 'N' };
  const LO = 12, HI = 88;

  const node = id => NODES.get(id);
  const floorName = f => f === 0 ? 'B1' : f > 5 ? `탑 ${f}F` : `${f}F`;
  const floorText = f => f === 0 ? t('floor_b1') : f > 5 ? t('floor_tower', { f }) : t('floor', { f });
  function label(id) {
    const n = node(id);
    if (!n) return id;
    if (n.kind === 'stair') return n.name.replace(/\|.*/, '');
    return n.label || n.name;
  }

  // "5남 335", "5S335", "남335", "5동211a" -> node id. Missing rooms fall back to the nearest number.
  function parseRoom(text) {
    const m = text.replace(/[\s\-호]/g, '').toUpperCase().match(/^5?(남|동|서|북|S|E|W|N)(\d)(\d{2})([A-Z])?$/);
    if (!m) return null;
    const w = WING[m[1]], f = +m[2], num = +m[3], suffix = m[4] || '';
    const want = `5${w}${f}${m[3]}${suffix}`;
    const shown = `${t('wing_' + w)} ${f}${m[3]}${suffix}`;
    const decode = t('room_decode', { wing: t('wing_' + w), f, room: f + m[3] });
    if (NODES.has(want)) return { id: want, label: shown, decode };
    const sameNum = [...NODES.values()].find(n => n.kind === 'room' && n.w === w && n.f === f && n.num === num);
    if (sameNum) return { id: sameNum.id, label: shown, decode };
    const near = [...NODES.values()].filter(n => n.kind === 'room' && n.w === w && n.f === f && !n.id.includes('화장실'))
      .sort((a, b) => Math.abs(a.num - num) - Math.abs(b.num - num))[0];
    return near ? { id: near.id, label: shown, decode, missing: true, near: near.label } : { id: null, label: shown, decode, missing: true };
  }

  function route(from, to, { nw = false } = {}) {
    const D = new Map([[from, 0]]), prev = new Map(), done = new Set();
    while (true) {
      let u = null, best = Infinity;
      for (const [k, d] of D) if (!done.has(k) && d < best) { best = d; u = k; }
      if (u === null) return null;
      if (u === to) break;
      done.add(u);
      for (const [v, w, flag] of ADJ.get(u)) {
        if (flag === 'nw' && !nw) continue;
        if (best + w < (D.get(v) ?? Infinity)) { D.set(v, best + w); prev.set(v, u); }
      }
    }
    const path = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0]));
    return { path, cost: D.get(to) };
  }

  function edgeType(a, b) {
    const A = node(a), B = node(b);
    if (A.kind === 'entrance' || B.kind === 'entrance') return 'enter';
    if (a.startsWith('B1:') && b.startsWith('B1:')) return 'b1';
    if ((a === 'T:5') !== (b === 'T:5') && A.f === B.f) return 'tower';
    if (A.f !== B.f) return 'vertical';
    if ((A.name === X_STAIR) || (B.name === X_STAIR)) return 'x';
    return 'walk';
  }
  const wingOf = ids => {
    const w = ids.map(id => node(id).w).filter(Boolean);
    return w.length ? w[w.length - 1] : null;
  };

  function buildSteps(path) {
    // Cut the path into runs of the same kind of movement.
    const runs = [];
    for (let i = 1; i < path.length; i++) {
      const type = edgeType(path[i - 1], path[i]);
      const last = runs[runs.length - 1];
      const wing = node(path[i]).w;
      const newWing = type === 'walk' && last && last.type === 'walk' && wing && last.wing && wing !== last.wing;
      if (last && last.type === type && !newWing) {
        last.ids.push(path[i]);
        if (wing) last.wing = wing;
      } else {
        runs.push({ type, ids: [path[i - 1], path[i]], wing: wing || (last && last.wing), turn: newWing });
      }
    }
    const steps = [];
    for (const r of runs) {
      const first = node(r.ids[0]), last = node(r.ids[r.ids.length - 1]);
      const s = { ids: r.ids, f: last.f };
      if (r.type === 'enter') {
        Object.assign(s, { icon: 'start', title: t('step_enter', { entrance: first.name }), sub: t('step_enter_sub', { place: label(last.id) }), f: 1 });
      } else if (r.type === 'walk') {
        const rooms = r.ids.map(node).filter(n => n.kind === 'room');
        if (rooms.length < 2 && steps.length && !r.turn) continue;   // a step across the landing, not worth its own card
        const up = rooms.length > 1 && rooms[rooms.length - 1].num > rooms[0].num;
        const wing = t('wing_' + (r.wing || wingOf(r.ids) || 'S'));
        Object.assign(s, r.turn
          ? { icon: 'right', title: t('step_turn', { wing, wing_ro: ro(wing) }), sub: t('step_turn_sub', { to: label(last.id) }) }
          : { icon: 'straight', title: t('step_walk', { wing }), sub: t('step_walk_sub', { dir: t(up ? 'dir_up' : 'dir_down'), count: Math.max(0, rooms.length - 1), to: label(last.id) }) });
      } else if (r.type === 'vertical') {
        const goingUp = last.f > first.f;
        // The basement stairs hang off the lift landing, but the lift itself doesn't go down there.
        const b1 = [first, last].find(n => n.id.startsWith('B1:'));
        const stair = b1 ? b1.name : first.kind === 'stair' ? label(first.id) : label(last.id);
        const lift = !b1 && stair.includes('엘리베이터');
        const name = stair === X_STAIR ? 'X자 계단' : lift ? t('stair_lift') : stair;
        Object.assign(s, {
          icon: goingUp ? 'up' : 'down',
          title: lift ? t('step_lift', { to: floorText(last.f) }) : t('step_stairs', { stair: name, stair_ro: ro(name), to: floorText(last.f) }),
          sub: t('step_stairs_sub', { from: floorText(first.f), to: floorText(last.f), dir: t(goingUp ? 'go_up' : 'go_down') }),
          from: first.f,
        });
      } else if (r.type === 'x') {
        Object.assign(s, { icon: 'x', title: t('step_x'), sub: t('step_x_sub'), warn: true });
      } else if (r.type === 'b1') {
        Object.assign(s, { icon: 'straight', title: t('step_b1_walk'), sub: t('step_b1_walk_sub') });
      } else if (r.type === 'tower') {
        Object.assign(s, { icon: 'right', title: t('step_tower_in'), sub: t('step_tower_in_sub'), warn: true });
      }
      steps.push(s);
    }
    const end = node(path[path.length - 1]);
    steps.push({ ids: [end.id], f: end.f, icon: 'arrive', title: t('step_arrive', { to: label(end.id) }), sub: end.kind === 'room' ? t('step_arrive_sub', { to: label(end.id) }) : t('step_arrive_place') });
    return steps;
  }

  // Draw one floor. k = map units per screen pixel, so strokes and text stay readable at any zoom.
  function drawFloor(f, k, plan, stepIdx) {
    let s = '';
    const band = 7;
    if (f === 0) {
      s += `<rect x="${HI - band / 2}" y="${LO}" width="${band}" height="${HI - LO}" rx="2" fill="#fff" stroke="var(--road-edge)" stroke-width="${k}"/>`;
      s += `<text class="lbl" x="${HI - 8}" y="50" font-size="${13 * k}" font-weight="800" fill="var(--muted)" stroke-width="${3 * k}" text-anchor="end">5동 지하</text>`;
    } else {
      s += `<rect x="${LO + band / 2}" y="${LO + band / 2}" width="${HI - LO - band}" height="${HI - LO - band}" fill="var(--pitch)" opacity=".5"/>`;
      s += `<rect x="${LO}" y="${LO}" width="${HI - LO}" height="${HI - LO}" fill="none" stroke="var(--road-edge)" stroke-width="${band + 1}"/>`;
      s += `<rect x="${LO}" y="${LO}" width="${HI - LO}" height="${HI - LO}" fill="none" stroke="#fff" stroke-width="${band}"/>`;
      if (f === 1) s += `<line x1="${LO}" y1="${LO + 4}" x2="${LO}" y2="${HI - 4}" stroke="var(--ground)" stroke-width="${band + 2}"/>`;
      for (const [w, x, y] of [['N', 50, LO + 12], ['E', HI - 12, 50], ['S', 50, HI - 9], ['W', LO + 12, 50]]) {
        if (f === 1 && w === 'W') continue;
        s += `<text class="lbl" x="${x}" y="${y}" font-size="${16 * k}" font-weight="800" fill="var(--ink)" stroke-width="${3 * k}" text-anchor="middle">${t('wing_' + w)}</text>`;
      }
      if (f > 5) s += `<rect x="${HI - 6}" y="${LO - 12}" width="12" height="12" rx="2" fill="var(--main)" stroke="var(--main-edge)" stroke-width="${1.5 * k}"/>`;
    }
    for (const n of NODES.values()) {
      if (n.f !== f || n.kind !== 'room') continue;
      s += `<circle cx="${n.x}" cy="${n.y}" r="${2.2 * k}" fill="var(--bldg-edge)"/>`;
    }
    for (const n of NODES.values()) {
      if (n.f !== f || n.kind !== 'stair') continue;
      s += `<rect x="${n.x - 3 * k}" y="${n.y - 3 * k}" width="${6 * k}" height="${6 * k}" fill="var(--muted)"/>`;
    }
    if (f === 1) for (const n of NODES.values()) if (n.kind === 'entrance') s += `<circle cx="${n.x}" cy="${n.y}" r="${5 * k}" fill="var(--ink)"/>`;

    // Route: every part on this floor faint, the current step bold.
    const onFloor = id => node(id).f === f;
    const segs = [];
    plan.steps.forEach((st, i) => {
      const pts = st.ids.filter(onFloor).map(node);
      if (pts.length > 1) segs.push({ pts, now: i === stepIdx });
    });
    for (const sg of segs) {
      const d = 'M' + sg.pts.map(n => `${n.x} ${n.y}`).join('L');
      s += `<path d="${d}" fill="none" stroke="${sg.now ? 'var(--route-case)' : 'none'}" stroke-width="${11 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += `<path d="${d}" fill="none" stroke="var(--route)" stroke-opacity="${sg.now ? 1 : .3}" stroke-width="${(sg.now ? 7 : 5) * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const cur = plan.steps[stepIdx];
    const tag = (n, text, fill) => {
      const w = (text.length * 12 + 16) * k, h = 22 * k;
      return `<g transform="translate(${n.x} ${n.y})"><rect x="${-w / 2}" y="${-h - 7 * k}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/><text y="${-7 * k - h / 2 + 4.3 * k}" font-size="${12 * k}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text><circle r="${4.5 * k}" fill="${fill}" stroke="#fff" stroke-width="${1.5 * k}"/></g>`;
    };
    const start = node(plan.path[0]), end = node(plan.path[plan.path.length - 1]);
    if (end.f === f) s += tag(end, label(end.id).replace(/^5[동서남북] /, ''), 'var(--dest)');
    if (start.f === f && start !== end) s += tag(start, start.kind === 'entrance' ? '입구' : '출발', 'var(--ink)');
    const here = cur.ids.map(node).filter(n => n.f === f);
    if (here.length && cur.icon !== 'arrive') {
      const n = here[here.length - 1];
      if (n !== end) s += `<circle cx="${n.x}" cy="${n.y}" r="${8 * k}" fill="none" stroke="var(--dest)" stroke-width="${3 * k}"/>`;
    }
    return s;
  }

  return { node, label, floorName, floorText, parseRoom, route, buildSteps, drawFloor, NODES };
})();
