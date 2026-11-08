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
          lift,
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

  // 3D view: floors stacked on top of each other, the current one solid, the route in blue.
  const H = 26;                                   // screen height of one floor
  const zOf = f => (f - 1) * H;
  const iso = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];
  const P = (x, y, z) => iso(x, y, z).map(v => v.toFixed(1)).join(',');
  const B = 4;                                    // half the corridor width
  const SHAPES = {
    ring: { x0: LO - B, y0: LO - B, x1: HI + B, y1: HI + B, hole: [LO + B, LO + B, HI - B, HI - B] },
    b1: { x0: HI - B, y0: LO - B, x1: HI + B, y1: HI + B },
    tower: { x0: HI - 6, y0: LO - 14, x1: HI + 6, y1: LO - 2 },
  };
  const shapeOf = f => f === 0 ? SHAPES.b1 : f > 5 ? SHAPES.tower : SHAPES.ring;
  const at = id => { const n = node(id); return iso(n.x, n.y, zOf(n.f)); };

  function slab(sh, z, op, t) {
    const { x0, y0, x1, y1, hole } = sh;
    let s = `<g opacity="${op}">`;
    s += `<polygon fill="var(--side)" points="${P(x0, y1, z)} ${P(x1, y1, z)} ${P(x1, y1, z - t)} ${P(x0, y1, z - t)}"/>`;
    s += `<polygon fill="var(--side2)" points="${P(x1, y0, z)} ${P(x1, y1, z)} ${P(x1, y1, z - t)} ${P(x1, y0, z - t)}"/>`;
    let d = `M${P(x0, y0, z)}L${P(x1, y0, z)}L${P(x1, y1, z)}L${P(x0, y1, z)}Z`;
    if (hole) {
      const [a, b, c, e] = hole;
      s += `<polygon fill="var(--side2)" points="${P(a, b, z)} ${P(c, b, z)} ${P(c, b, z - t)} ${P(a, b, z - t)}"/>`;
      s += `<polygon fill="var(--side)" points="${P(a, b, z)} ${P(a, e, z)} ${P(a, e, z - t)} ${P(a, b, z - t)}"/>`;
      d += `M${P(a, b, z)}L${P(c, b, z)}L${P(c, e, z)}L${P(a, e, z)}Z`;
    }
    return s + `<path fill-rule="evenodd" fill="var(--b-top)" stroke="var(--b-line)" stroke-width=".6" d="${d}"/></g>`;
  }

  // Room numbers on a floor, per wing, shown as a range ("301~360") instead of a dot per room.
  const RANGES = {};
  for (const n of NODES.values()) {
    if (n.kind !== 'room' || n.id.includes('화장실')) continue;
    const key = `${n.f}${n.w}`, num = n.f * 100 + n.num;
    const r = RANGES[key] || (RANGES[key] = [num, num]);
    r[0] = Math.min(r[0], num);
    r[1] = Math.max(r[1], num);
  }

  // A zig-zag staircase at (x, y) between two floors: one 8-step flight per floor, turning back each time.
  function staircase(x, y, f1, f2, now) {
    const lo = Math.min(f1, f2), hi = Math.max(f1, f2), run = 2.2, half = 4 * run, W = 5;
    const top = now ? 'var(--accent-soft)' : 'var(--b-top)', rise = now ? 'var(--main-side)' : 'var(--b-side)', edge = now ? 'var(--route)' : 'var(--b-line)';
    let s = `<g opacity="${now ? 1 : .35}">`;
    for (let f = lo; f < hi; f++) {
      const back = (f - lo) % 2 === 1, order = back ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      for (const i of order) {
        const z = zOf(f) + (i + 1) * H / 8, zb = z - H / 8;
        const x0 = back ? x + half - (i + 1) * run : x - half + i * run, x1 = x0 + run;
        s += `<polygon fill="${rise}" stroke="${edge}" stroke-width=".3" points="${P(x0, y + W, z)} ${P(x1, y + W, z)} ${P(x1, y + W, zb)} ${P(x0, y + W, zb)}"/>`;
        s += `<polygon fill="${rise}" stroke="${edge}" stroke-width=".3" points="${P(back ? x0 : x1, y - W, z)} ${P(back ? x0 : x1, y + W, z)} ${P(back ? x0 : x1, y + W, zb)} ${P(back ? x0 : x1, y - W, zb)}"/>`;
        s += `<polygon fill="${top}" stroke="${edge}" stroke-width=".3" points="${P(x0, y - W, z)} ${P(x1, y - W, z)} ${P(x1, y + W, z)} ${P(x0, y + W, z)}"/>`;
      }
    }
    return s + '</g>';
  }
  // The lift: a glass shaft between the two floors.
  function liftShaft(x, y, f1, f2, now, k) {
    const z0 = zOf(Math.min(f1, f2)), z1 = zOf(Math.max(f1, f2)), r = 3.5;
    const [lx, ly] = iso(x + r, y + r, z1);
    return `<g opacity="${now ? 1 : .35}"><polygon fill="var(--accent-soft)" fill-opacity=".75" stroke="var(--route)" stroke-width=".5" points="${P(x - r, y + r, z1)} ${P(x + r, y + r, z1)} ${P(x + r, y + r, z0)} ${P(x - r, y + r, z0)}"/>`
      + `<polygon fill="var(--main-side)" fill-opacity=".6" stroke="var(--route)" stroke-width=".5" points="${P(x + r, y - r, z1)} ${P(x + r, y + r, z1)} ${P(x + r, y + r, z0)} ${P(x + r, y - r, z0)}"/>`
      + `<text x="${lx + 3 * k}" y="${ly + 14 * k}" font-size="${11 * k}" font-weight="800" fill="var(--route)">EV</text></g>`;
  }

  function drawIso(k, plan, stepIdx) {
    const cur = plan.steps[stepIdx];
    const floors = [...new Set([1, 2, 3, 4, 5, ...plan.path.map(id => node(id).f)])].sort((a, b) => a - b);
    const top = Math.max(cur.f, cur.from ?? -1);
    let s = '';
    for (const f of floors) {
      const op = f === cur.f ? 1 : f === cur.from ? .55 : f < top ? .16 : .05;
      s += slab(shapeOf(f), zOf(f), op, f === cur.f ? 4 : 2.5);
      if (f !== cur.f) continue;
      const z = zOf(f);
      if (f >= 1 && f <= 5) {
        for (const [w, x, y] of [['N', 50, LO], ['E', HI, 50], ['S', 50, HI], ['W', LO, 50]]) {
          if (f === 1 && w === 'W') continue;
          const [px, py] = iso(x, y, z), r = RANGES[`${f}${w}`];
          s += `<text class="lbl" x="${px}" y="${py - 9 * k}" font-size="${15 * k}" font-weight="800" fill="var(--ink)" stroke-width="${3.5 * k}" text-anchor="middle">${t('wing_' + w)}</text>`;
          if (r) s += `<text class="lbl" x="${px}" y="${py + 7 * k}" font-size="${11 * k}" font-weight="600" fill="var(--muted)" stroke-width="${3 * k}" text-anchor="middle">${r[0]}~${r[1]}호</text>`;
        }
      }
      const sh = shapeOf(f), [fx, fy] = iso(sh.x0, sh.y0, z);
      s += `<text class="lbl" x="${fx - 14 * k}" y="${fy + 6 * k}" font-size="${18 * k}" font-weight="800" fill="var(--route)" stroke-width="${3 * k}" text-anchor="end">${floorName(f)}</text>`;
    }
    // Stairs and the lift for every floor change on the way; the current one solid.
    plan.steps.forEach((st, i) => {
      if (st.from === undefined) return;
      const anchor = st.ids.map(node).find(n => n.kind === 'stair' && n.f === st.from) || node(st.ids[0]);
      s += st.lift ? liftShaft(anchor.x, anchor.y, st.from, st.f, i === stepIdx, k) : staircase(anchor.x, anchor.y, st.from, st.f, i === stepIdx);
    });
    // Route on the floor you're looking at: this step bold, the rest of this floor faint. Floor changes are the stairs above.
    const sameFloor = ids => {
      const runs = [];
      for (let i = 1; i < ids.length; i++) {
        const a = node(ids[i - 1]), b = node(ids[i]);
        if (a.f !== b.f) continue;
        const last = runs[runs.length - 1];
        if (last && last[last.length - 1] === ids[i - 1]) last.push(ids[i]); else runs.push([ids[i - 1], ids[i]]);
      }
      return runs;
    };
    const line = ids => 'M' + ids.map(id => at(id).map(v => v.toFixed(1)).join(' ')).join('L');
    for (const run of sameFloor(plan.path)) {
      if (node(run[0]).f !== cur.f) continue;
      s += `<path d="${line(run)}" fill="none" stroke="var(--route)" stroke-opacity=".25" stroke-width="${4 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    for (const run of sameFloor(cur.ids)) {
      s += `<path d="${line(run)}" fill="none" stroke="var(--route-case)" stroke-width="${11 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += `<path d="${line(run)}" fill="none" stroke="var(--route)" stroke-width="${7 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const tag = (id, text, fill) => {
      const [x, y] = at(id), w = (text.length * 12 + 16) * k, h = 22 * k;
      return `<g transform="translate(${x} ${y})"><rect x="${-w / 2}" y="${-h - 7 * k}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/><text y="${-7 * k - h / 2 + 4.3 * k}" font-size="${12 * k}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text><circle r="${4.5 * k}" fill="${fill}" stroke="#fff" stroke-width="${1.5 * k}"/></g>`;
    };
    const start = plan.path[0], end = plan.path[plan.path.length - 1];
    if (start !== end && (node(start).f === cur.f || node(start).f === cur.from)) s += tag(start, node(start).kind === 'entrance' ? '입구' : '출발', 'var(--ink)');
    s += tag(end, label(end).replace(/^5[동서남북] /, ''), 'var(--dest)');
    if (cur.icon !== 'arrive') {
      const [x, y] = at(cur.ids[cur.ids.length - 1]);
      s += `<circle cx="${x}" cy="${y}" r="${8 * k}" fill="none" stroke="var(--dest)" stroke-width="${3 * k}"/>`;
    }
    return s;
  }

  // What the camera should keep in view for a step: the floor(s) involved and the step's own path.
  function viewBounds(plan, stepIdx) {
    const cur = plan.steps[stepIdx], pts = [];
    if (cur.from !== undefined) {
      // floor change: close in on the stairs (or lift) so their shape is readable
      const a = cur.ids.map(node).find(n => n.kind === 'stair' && n.f === cur.from) || node(cur.ids[0]);
      for (const f of [cur.from, cur.f]) for (const [dx, dy] of [[-22, -22], [22, -22], [22, 22], [-22, 22]]) pts.push(iso(a.x + dx, a.y + dy, zOf(f)));
      return pts;
    }
    for (const f of [cur.f, cur.from].filter(v => v !== undefined)) {
      const sh = shapeOf(f), z = zOf(f);
      for (const [x, y] of [[sh.x0, sh.y0], [sh.x1, sh.y0], [sh.x1, sh.y1], [sh.x0, sh.y1]]) pts.push(iso(x, y, z));
    }
    cur.ids.forEach(id => pts.push(at(id)));
    return pts;
  }

  return { node, label, floorName, floorText, parseRoom, route, buildSteps, drawIso, viewBounds };
})();
