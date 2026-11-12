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
  const floorName = f => f === 0 ? 'B1' : f > 5 ? `T${f}F` : `${f}F`;
  const floorText = f => f === 0 ? t('floor_b1') : f > 5 ? t('floor_tower', { f }) : t('floor', { f });
  function label(id) {
    const n = node(id);
    if (!n) return id;
    if (n.kind === 'stair') return localName(n.name.replace(/\|.*/, ''));
    if (n.kind === 'room') return roomName(n);
    return localName(n.label || n.name);
  }

  // Reads a room however people type it: "5E 107A", "5e-107a", "5동 107A", "5동관 107", "동107", "5남 335",
  // "5호관 5S335", "E107". "107" alone, or 107 when the room is split into 107A/107B, comes back as a list to pick from.
  const ROOMS = [...NODES.values()].filter(n => n.kind === 'room' && !n.id.includes('화장실'));
  const roomName = n => {
    const room = n.id.slice(2).replace(' (화장실)', '');
    const name = t('nav.room_label', { wing: t('wing_' + n.w), room });
    return n.id.includes('화장실') ? t('nav.room_restroom', { room: name }) : name;
  };
  function readable(text) {
    return text.normalize('NFKC').toUpperCase()
      .replace(/5\s*호\s*관/g, '')
      .replace(/EAST/g, 'E').replace(/WEST/g, 'W').replace(/SOUTH/g, 'S').replace(/NORTH/g, 'N')
      .replace(/호실|호|관|[\s\-_.·,/()]/g, '');
  }
  function parseRoom(text) {
    const s = readable(text);
    const withWing = s.match(/^(\d)?(남|동|서|북|S|E|W|N)(\d)(\d{2})([A-Z])?$/);
    const numberOnly = s.match(/^(\d)(\d{2})([A-Z])?$/);
    if (!withWing && !numberOnly) return null;
    const [w, f, nn, suffix] = withWing ? [WING[withWing[2]], +withWing[3], withWing[4], withWing[5] || ''] : [null, +numberOnly[1], numberOnly[2], numberOnly[3] || ''];
    const num = +nn, room = `${f}${nn}${suffix}`;
    const otherBuilding = withWing && withWing[1] && withWing[1] !== '5';
    const sameNum = ROOMS.filter(n => n.f === f && n.num === num && (!w || n.w === w));
    const exact = sameNum.filter(n => n.id.slice(5) === suffix);
    const decode = n => t('room_decode', { wing: t('wing_' + n.w), f, room: n.id.slice(2) }) + (n.id.length > 5 ? ' · ' + t('room_split_tag', { base: `${f}${nn}` }) : '');
    const found = n => ({ id: n.id, label: roomName(n), decode: decode(n), note: otherBuilding ? t('room_other_building', { label: roomName(n) }) : '' });
    if (!w) {
      // only a number: which wing?
      const list = suffix ? exact : sameNum;
      if (!list.length) return { id: null, label: room, missing: true };
      return list.length === 1 ? found(list[0]) : { candidates: list.map(n => ({ id: n.id, label: roomName(n), decode: decode(n) })), note: t('room_number_only', { room }) };
    }
    if (exact.length) return found(exact[0]);
    if (sameNum.length) {
      // e.g. 107 typed but the room is split into 107A / 107B
      return { candidates: sameNum.map(n => ({ id: n.id, label: roomName(n), decode: decode(n) })), note: t('room_split_note', { base: `${t('wing_' + w)} ${f}${nn}`, list: sameNum.map(n => n.id.slice(5)).join('·') }) };
    }
    const label = `${t('wing_' + w)} ${room}`;
    const near = ROOMS.filter(n => n.w === w && n.f === f).sort((a, b) => Math.abs(a.num - num) - Math.abs(b.num - num))[0];
    return near ? { id: near.id, label, decode: decode(near), missing: true, near: roomName(near) } : { id: null, label, missing: true };
  }

  // Floor changes must use an actual stair/lift/tower connection. The source
  // data also contains a room-to-room 5F/3F link; it is not a usable stair.
  const isConnector = n => n.kind === 'stair' || n.id.startsWith('T:') || n.id === 'B1S:clubs';
  const isFloorLink = (a, b) => Math.abs(a.f - b.f) === 1 && isConnector(a) && isConnector(b);
  // Use the actual consecutive floor-changing edge, not a staircase merely
  // passed earlier in the step, as the position of a rendered connector.
  const floorChanges = ids => ids.slice(1).flatMap((id, i) => {
    const a = node(ids[i]), b = node(id);
    return a && b && a.f !== b.f && isFloorLink(a, b) ? [[a, b]] : [];
  });
  const connectorAnchor = st => floorChanges(st.ids).find(([a]) => a.f === st.from)?.[0];

  function search(from, nw, allow, target) {
    const D = new Map([[from, 0]]), prev = new Map(), done = new Set();
    while (true) {
      let u = null, best = Infinity;
      for (const [k, d] of D) if (!done.has(k) && d < best) { best = d; u = k; }
      if (u === null || u === target) break;
      done.add(u);
      for (const [v, w, flag] of ADJ.get(u)) {
        if (flag === 'nw' && !nw) continue;
        const a = node(u), b = node(v);
        if (a.f !== b.f && !isFloorLink(a, b)) continue;
        if (!allow(a, b)) continue;
        if (best + w < (D.get(v) ?? Infinity)) { D.set(v, best + w); prev.set(v, u); }
      }
    }
    return { D, prev };
  }

  function pathFrom(tree, from, to) {
    if (!tree.D.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(tree.prev.get(path[0]));
    return path;
  }

  function route(from, to, { nw = false } = {}) {
    if (!NODES.has(from) || !NODES.has(to)) return null;
    const startFloor = node(from).f, goalFloor = node(to).f;
    const onFloor = f => (a, b) => a.f === f && b.f === f;
    const approach = search(from, nw, onFloor(startFloor), startFloor === goalFloor ? to : undefined);

    // A connected same-floor corridor always takes precedence over a shortcut
    // that leaves the floor and returns via another staircase.
    if (startFloor === goalFloor && approach.D.has(to)) {
      return { path: pathFrom(approach, from, to), cost: approach.D.get(to) };
    }

    if (startFloor !== goalFloor) {
      const arrival = search(to, nw, onFloor(goalFloor));
      const direction = Math.sign(goalFloor - startFloor);
      const towardGoal = (a, b) => isFloorLink(a, b)
        && Math.sign(b.f - a.f) === direction
        && (goalFloor - b.f) * direction >= 0;
      let best = null;
      for (const [landing, walkCost] of approach.D) {
        if (best && walkCost > best.walkCost) continue;
        if (!ADJ.get(landing).some(([next, , flag]) => (flag !== 'nw' || nw) && towardGoal(node(landing), node(next)))) continue;
        const vertical = search(landing, nw, towardGoal);
        for (const [exit, riseCost] of vertical.D) {
          if (node(exit).f !== goalFloor || !arrival.D.has(exit)) continue;
          const cost = walkCost + riseCost + arrival.D.get(exit);
          // First use the nearest usable floor connection, then the shortest
          // route among equally near connections. Do not encode this as metres.
          if (best && (walkCost > best.walkCost || (walkCost === best.walkCost && cost >= best.cost))) continue;
          best = { walkCost, cost, path: [
            ...pathFrom(approach, from, landing),
            ...pathFrom(vertical, landing, exit).slice(1),
            ...pathFrom(arrival, to, exit).reverse().slice(1),
          ] };
        }
      }
      if (best) return { path: best.path, cost: best.cost };
    }

    // Some destinations require a transfer (tower stairs at 5F) or another
    // floor (the separate basements). Use only existing, valid connections.
    const fallback = search(from, nw, () => true, to);
    const path = pathFrom(fallback, from, to);
    return path ? { path, cost: fallback.D.get(to) } : null;
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

  // Door numbers you can check along the way: a few rooms you'll pass, one you'd see going the wrong way,
  // and the rooms either side of where you arrive.
  const doorNo = n => n.id.slice(2);
  const isDoor = n => n && n.kind === 'room' && !n.id.includes('화장실');
  function checkpoints(rooms) {
    const doors = rooms.filter(isDoor);
    if (doors.length <= 4) return doors;
    return [...new Set([0, Math.round(doors.length / 3), Math.round(2 * doors.length / 3), doors.length - 1])].map(i => doors[i]);
  }
  function wrongWay(ids, up) {
    const onPath = new Set(ids), first = node(ids[0]);
    const near = ADJ.get(first.id).map(([v]) => node(v)).filter(n => isDoor(n) && n.f === first.f && !onPath.has(n.id));
    const start = ids.map(node).find(isDoor);
    return near.find(n => start && (up ? n.num < start.num : n.num > start.num)) || null;
  }
  const besides = id => ADJ.get(id).map(([v]) => node(v)).filter(n => isDoor(n) && n.f === node(id).f).slice(0, 2);

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
        Object.assign(s, { icon: 'start', title: t('step_enter', { entrance: localName(first.name) }), sub: t('step_enter_sub', { place: label(last.id) }), f: 1, photo: first.id === 'ENT:corner' ? 'door' : undefined });
        if (first.id === 'ENT:south') s.fieldPhoto = '0844';
      } else if (r.type === 'walk') {
        const rooms = r.ids.map(node).filter(n => n.kind === 'room');
        if (rooms.length < 2 && steps.length && !r.turn) continue;   // a step across the landing, not worth its own card
        const up = rooms.length > 1 && rooms[rooms.length - 1].num > rooms[0].num;
        const wing = t('wing_' + (r.wing || wingOf(r.ids) || 'S'));
        const checks = checkpoints(rooms.filter(n => n.id !== r.ids[0])), wrong = r.turn ? null : wrongWay(r.ids, up);   // not the door you're standing at
        const passed = rooms.filter(n => n.id !== r.ids[0] && n.id !== last.id).length;
        const walkSub = passed ? t('step_walk_sub', { dir: t(up ? 'dir_up' : 'dir_down'), count: passed, to: label(last.id) }) : t('step_walk_near', { to: label(last.id) });
        const extra = [checks.length > 1 ? t('step_checks', { list: checks.map(doorNo).join(' → ') }) : '', wrong ? t('step_wrong', { room: doorNo(wrong) }) : ''].filter(Boolean).join(' · ');
        Object.assign(s, r.turn
          ? { icon: 'right', title: t('step_turn', { wing, wing_ro: ro(wing) }), sub: [t('step_turn_sub', { to: label(last.id) }), extra].filter(Boolean).join(' · ') }
          : { icon: 'straight', title: t('step_walk', { wing }), sub: [walkSub, extra].filter(Boolean).join(' · ') },
          { checks: checks.map(n => n.id), wrong: wrong && wrong.id });
      } else if (r.type === 'vertical') {
        const goingUp = last.f > first.f;
        // The basement stairs hang off the lift landing, but the lift itself doesn't go down there.
        const b1 = [first, last].find(n => n.id.startsWith('B1:'));
        const stair = b1 ? b1.name : first.kind === 'stair' ? first.name : (last.name || last.label);
        const lift = !b1 && stair.includes('엘리베이터');
        const name = stair === X_STAIR ? t('nav.xstairs') : lift ? t('stair_lift') : localName(stair);
        Object.assign(s, {
          icon: goingUp ? 'up' : 'down',
          title: lift ? t('step_lift', { to: floorText(last.f) }) : t('step_stairs', { stair: name, stair_ro: ro(name), to: floorText(last.f) }),
          sub: t('step_stairs_sub', { from: floorText(first.f), to: floorText(last.f), dir: t(goingUp ? 'go_up' : 'go_down') }),
          from: first.f,
          lift,
          photo: b1 ? { 'B1:north': 'bnorth', 'B1:south': 'bsouth' }[b1.id] : undefined,
        });
      } else if (r.type === 'x') {
        Object.assign(s, { icon: 'x', title: t('step_x'), sub: t('step_x_sub'), warn: true });
      } else if (r.type === 'b1') {
        Object.assign(s, { icon: 'straight', title: t('step_b1_walk'), sub: t('step_b1_walk_sub') });
      } else if (r.type === 'tower') {
        Object.assign(s, { icon: 'right', title: t('step_tower_in'), sub: t('step_tower_in_sub'), warn: true, photo: 'towersign' });
      }
      const southDescent = first.id === '5남 중앙 계단|1' && last.id === 'B1S:clubs';
      if (southDescent) {
        steps.push({ ids: [first.id], f: 1, icon: 'right', fieldPhoto: '0845',
          title: t('nav.south_orient'),
          sub: t('nav.south_orient_sub') });
        Object.assign(s, { fieldPhoto: '0846', connectorGroup: 'south-central',
          title: t('nav.south_down'),
          sub: t('nav.south_down_sub') });
      }
      steps.push(s);
      if (southDescent) steps.push({ ...s, fieldPhoto: '0847', connectorDuplicate: true,
        title: t('nav.south_mid'),
        sub: t('nav.south_mid_sub') });
    }
    if (steps[0] && steps[0].photo === 'door' && steps[1] && !steps[1].photo) steps[1].photo = 'lobby';
    const end = node(path[path.length - 1]);
    const side = end.kind === 'room' ? besides(end.id) : [];
    steps.push({
      ids: [end.id], f: end.f, icon: 'arrive', title: t('step_arrive', { to: label(end.id) }),
      sub: end.kind === 'room' ? [t('step_arrive_sub', { to: label(end.id) }), side.length ? t('step_neighbors', { list: side.map(doorNo).join(' · ') }) : ''].filter(Boolean).join(' · ') : t('step_arrive_place'),
      checks: side.map(n => n.id),
      ...(end.id === 'B1S:clubs' ? { fieldPhoto: '0850', sub: t('nav.south_arrive_sub') } : {}),
    });
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

  // Rooms as low blocks either side of the corridor, numbered on top. The data only says which rooms are
  // neighbours, so the side is a guess (odd numbers on the outside, even on the courtyard side) and rooms that
  // share a spot split it. mark(id) colours the ones that matter for this step; those whose number doesn't fit
  // on the block come back in `loose` to be tagged separately.
  function roomBlocks(f, k, mark, inTheWay) {
    const D = 7, h = 4, z = zOf(f), cells = [], loose = [];
    const rooms = [...NODES.values()].filter(n => n.kind === 'room' && n.f === f && !n.id.includes('화장실'));
    for (const [along, fixed, outward] of [['y', HI, 1], ['x', LO, -1], ['x', HI, 1], ['y', LO, -1]]) {
      const across = along === 'y' ? 'x' : 'y';
      for (const outside of [true, false]) {
        const mine = rooms.filter(n => Math.abs(n[across] - fixed) < .5 && (n.num % 2 === 1) === outside);
        const spots = [...new Set(mine.map(n => n[along]))].sort((a, b) => a - b);
        spots.forEach((v, i) => {
          const lo = i ? (spots[i - 1] + v) / 2 : v - 3, hi = i < spots.length - 1 ? (v + spots[i + 1]) / 2 : v + 3;
          const here = mine.filter(n => n[along] === v).sort((a, b) => a.num - b.num);
          here.forEach((n, j) => {
            const a0 = lo + (hi - lo) * j / here.length + .3, a1 = lo + (hi - lo) * (j + 1) / here.length - .3;
            const d0 = (outside ? outward : -outward) > 0 ? fixed + B : fixed - B - D;
            const [x0, x1, y0, y1] = along === 'y' ? [d0, d0 + D, a0, a1] : [a0, a1, d0, d0 + D];
            cells.push({ n, x0, x1, y0, y1, len: a1 - a0 });
          });
        });
      }
    }
    cells.sort((a, b) => (a.x0 + a.y0) - (b.x0 + b.y0));     // far ones first
    let s = '';
    for (const { n, x0, x1, y0, y1, len } of cells) {
      const m = mark(n.id), zt = z + h;
      // outline on screen: top face plus the two visible sides
      const outline = [iso(x0, y0, zt), iso(x1, y0, zt), iso(x1, y0, z), iso(x1, y1, z), iso(x0, y1, z), iso(x0, y1, zt)];
      if (m !== 'dest' && inTheWay(outline, (x0 + x1) / 2 + (y0 + y1) / 2)) {
        s += `<polygon fill="var(--b-top)" fill-opacity=".35" stroke="var(--b-line)" stroke-opacity=".5" stroke-width=".25" points="${outline.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
        if (m && m !== 'start') loose.push(n.id);
        continue;
      }
      const top = { dest: 'var(--route)', start: 'var(--ink)', check: 'var(--accent-soft)', wrong: 'var(--soft)' }[m] || 'var(--b-top)';
      const edge = m === 'dest' || m === 'check' ? 'var(--route)' : m ? 'var(--bldg-edge)' : 'var(--b-line)';
      s += `<polygon fill="var(--b-side)" stroke="${edge}" stroke-width=".25" points="${P(x0, y1, zt)} ${P(x1, y1, zt)} ${P(x1, y1, z)} ${P(x0, y1, z)}"/>`;
      s += `<polygon fill="var(--b-side2)" stroke="${edge}" stroke-width=".25" points="${P(x1, y0, zt)} ${P(x1, y1, zt)} ${P(x1, y1, z)} ${P(x1, y0, z)}"/>`;
      s += `<polygon fill="${top}" stroke="${edge}" stroke-width="${m ? .6 : .3}" points="${P(x0, y0, zt)} ${P(x1, y0, zt)} ${P(x1, y1, zt)} ${P(x0, y1, zt)}"/>`;
      if (m === 'dest' || m === 'start') continue;  // these already carry a big tag
      const text = (m === 'wrong' ? '✕' : '') + doorNo(n), fits = len / k > text.length * (m ? 5.5 : 6.5);
      if (!fits) { if (m) loose.push(n.id); continue; }
      const [tx, ty] = iso((x0 + x1) / 2, (y0 + y1) / 2, zt);
      s += `<text x="${tx}" y="${ty + 3.5 * k}" font-size="${(m ? 11 : 9.5) * k}" font-weight="${m ? 800 : 600}" fill="${m === 'check' ? 'var(--route)' : m ? 'var(--muted)' : 'var(--ink)'}" text-anchor="middle">${text}</text>`;
    }
    return { svg: s, loose };
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
    const face = now ? 'var(--accent-soft)' : 'var(--b-top)', side = now ? 'var(--main-side)' : 'var(--b-side)';
    const edge = now ? 'var(--route)' : 'var(--b-line)', labelColor = now ? 'var(--route)' : 'var(--muted)';
    return `<g opacity="${now ? 1 : .35}"><polygon fill="${face}" fill-opacity=".75" stroke="${edge}" stroke-width=".5" points="${P(x - r, y + r, z1)} ${P(x + r, y + r, z1)} ${P(x + r, y + r, z0)} ${P(x - r, y + r, z0)}"/>`
      + `<polygon fill="${side}" fill-opacity=".6" stroke="${edge}" stroke-width=".5" points="${P(x + r, y - r, z1)} ${P(x + r, y + r, z1)} ${P(x + r, y + r, z0)} ${P(x + r, y - r, z0)}"/>`
      + `<text x="${lx + 3 * k}" y="${ly + 14 * k}" font-size="${11 * k}" font-weight="800" fill="${labelColor}">EV</text></g>`;
  }

  function drawIso(k, plan, stepIdx, bounds = null) {
    const cur = plan.steps[stepIdx];
    const floors = [...new Set([1, 2, 3, 4, 5, ...plan.path.map(id => node(id).f)])].sort((a, b) => a - b);
    const top = Math.max(cur.f, cur.from ?? -1);
    const start = plan.path[0], end = plan.path[plan.path.length - 1];
    const mark = id => id === end ? 'dest' : id === start ? 'start' : id === cur.wrong ? 'wrong' : (cur.checks || []).includes(id) ? 'check' : '';
    const taken = [];                             // screen boxes already used by labels, so room tags don't pile up
    let loose = [];
    let s = '';
    const southLanding = { x0: 55.8, y0: 84, x1: 63.8, y1: 92 };
    const hasSouthB1 = plan.path.includes('B1S:clubs');
    const hasEastB1 = plan.path.some(id => id.startsWith('B1:'));
    const floorShapes = f => f === 0 && hasSouthB1
      ? [...(hasEastB1 ? [SHAPES.b1] : []), southLanding] : [shapeOf(f)];
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
    // The ring floors are four corridors meeting at right angles, so a hop from one wing to the next turns at the corner.
    const onRing = n => n.f >= 1 && n.f <= 5 && !n.id.startsWith('T:');
    const vert = n => Math.abs(n.x - LO) < .5 || Math.abs(n.x - HI) < .5;
    const horiz = n => Math.abs(n.y - LO) < .5 || Math.abs(n.y - HI) < .5;
    const corridor = ids => {                    // world points [x, y, z] along a same-floor run
      const pts = [];
      ids.map(node).forEach((b, i, ns) => {
        const a = ns[i - 1];
        if (a && onRing(a) && onRing(b) && !(vert(a) && vert(b) && a.x === b.x) && !(horiz(a) && horiz(b) && a.y === b.y)) {
          if (vert(a) && horiz(b)) pts.push([a.x, b.y, zOf(b.f)]);
          else if (horiz(a) && vert(b)) pts.push([b.x, a.y, zOf(b.f)]);
        }
        pts.push([b.x, b.y, zOf(b.f)]);
      });
      return pts;
    };
    const line = ids => 'M' + corridor(ids).map(p => iso(...p).map(v => v.toFixed(1)).join(' ')).join('L');

    // What has to stay visible on this floor: the route (sampled every unit), the start and end, and the
    // stairs or lift of this step. A room block standing in front of any of it goes see-through.
    const keep = [];
    for (const run of sameFloor(plan.path)) {
      if (node(run[0]).f !== cur.f) continue;
      const pts = corridor(run);
      pts.forEach((b, i) => {
        const a = pts[i - 1] || b, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let j = 1; j <= n; j++) keep.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, b[2]]);
      });
    }
    for (const id of [start, end]) if (node(id).f === cur.f) keep.push([node(id).x, node(id).y, zOf(cur.f)]);
    const shaftBoxes = [];
    if (cur.from !== undefined) {
      const a = connectorAnchor(cur) || node(cur.ids[0]);
      const [rx, ry] = cur.lift ? [4, 4] : [9, 5.5];
      const corners = [];
      for (const dx of [-rx, rx]) for (const dy of [-ry, ry]) for (const f of [cur.from, cur.f]) corners.push(iso(a.x + dx, a.y + dy, zOf(f)));
      shaftBoxes.push([Math.min(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[0])), Math.max(...corners.map(c => c[1]))]);
    }
    const inside = (p, poly) => poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length];
      return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    });
    const inTheWay = (outline, depth) => {
      const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (shaftBoxes.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) return true;
      return keep.some(w => w[0] + w[1] < depth && inside(iso(...w), outline));
    };

    for (const f of floors) {
      const op = f === cur.f ? 1 : f === cur.from ? .55 : f < top ? .16 : .05;
      for (const sh of floorShapes(f)) s += slab(sh, zOf(f), op, f === cur.f ? 4 : 2.5);
      if (f !== cur.f) continue;
      const z = zOf(f);
      if (f >= 1 && f <= 5) {
        const rb = roomBlocks(f, k, mark, inTheWay);
        s += rb.svg;
        loose = rb.loose;
        for (const [w, x, y] of [['N', 50, LO + B + 20], ['E', HI - B - 20, 50], ['S', 50, HI - B - 20], ['W', LO + B + 20, 50]]) {   // in the courtyard, clear of the rooms
          if (f === 1 && w === 'W') continue;
          const [px, py] = iso(x, y, z), r = RANGES[`${f}${w}`];
          // Shared room codes stay short and match the search examples/signs.
          // The instruction card carries the full translated wing name.
          const wingText = LANG === 'ko' ? t('wing_' + w) : '5' + w;
          const rangeText = r ? t('nav.rooms', { first: r[0], last: r[1] }) : '';
          const labelWidth = Math.max(textWidth(wingText, 15, 800), textWidth(rangeText, 11, 600)) + 8;
          taken.push([px - labelWidth * k / 2, py - 24 * k, px + labelWidth * k / 2, py + (r ? 11 : -4) * k]);
          s += `<text class="lbl" x="${px}" y="${py - 9 * k}" font-size="${15 * k}" font-weight="800" fill="var(--ink)" stroke-width="${3.5 * k}" text-anchor="middle">${wingText}</text>`;
          if (r) s += `<text class="lbl" x="${px}" y="${py + 7 * k}" font-size="${11 * k}" font-weight="600" fill="var(--muted)" stroke-width="${3 * k}" text-anchor="middle">${rangeText}</text>`;
        }
      }
      const sh = floorShapes(f)[0], [fx, fy] = iso(sh.x0, sh.y0, z);
      s += `<text class="lbl" x="${fx - 14 * k}" y="${fy + 6 * k}" font-size="${18 * k}" font-weight="800" fill="var(--route)" stroke-width="${3 * k}" text-anchor="end">${floorName(f)}</text>`;
    }
    // A landing along a walk is not a stair instruction. Highlight only the
    // floor-changing edges actually traversed by this route and this step.
    // Keep other connectors neutral, including a lift waiting in a later step.
    const floorEdges = ids => floorChanges(ids).map(([a, b]) => JSON.stringify([a.id, b.id]));
    const traversed = new Set(floorEdges(plan.path)), currentEdges = new Set(floorEdges(cur.ids));
    plan.steps.forEach((st, i) => {
      if (st.from === undefined || st.connectorDuplicate) return;
      const edges = floorEdges(st.ids), onRoute = edges.length > 0 && edges.every(edge => traversed.has(edge));
      const anchor = connectorAnchor(st);
      if (!anchor) return;
      const sameConnector = st.connectorGroup && st.connectorGroup === cur.connectorGroup && edges.some(edge => currentEdges.has(edge));
      const active = onRoute && (i === stepIdx || !!sameConnector);
      const name = svgText(anchor.id).replace(/"/g, '&quot;');
      s += `<g data-connector="${st.lift ? 'lift' : 'stairs'}" data-connector-node="${name}" data-route-connector="${onRoute}" data-connector-active="${active}">`;
      s += st.lift ? liftShaft(anchor.x, anchor.y, st.from, st.f, active, k) : staircase(anchor.x, anchor.y, st.from, st.f, active);
      s += '</g>';
    });
    // Route on the floor you're looking at: this step bold, the rest of this floor faint. Floor changes are the stairs above.
    for (const run of sameFloor(plan.path)) {
      if (node(run[0]).f !== cur.f) continue;
      s += `<path d="${line(run)}" fill="none" stroke="var(--route)" stroke-opacity=".25" stroke-width="${4 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    for (const run of sameFloor(cur.ids)) {
      s += `<path d="${line(run)}" fill="none" stroke="var(--route-case)" stroke-width="${11 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += `<path d="${line(run)}" fill="none" stroke="var(--route)" stroke-width="${7 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const tag = (id, text, fill) => {
      const [x, y] = at(id);
      const bounded = bounds && Number.isFinite(bounds.left) && Number.isFinite(bounds.right) && bounds.right - bounds.left > 16 * k;
      const lines = bounded ? mapLabelLines(text, (bounds.right - bounds.left) / k - 16, 12, 700) : [text];
      const w = (Math.max(...lines.map(line => textWidth(line, 12, 700))) + 16) * k;
      const h = (22 + (lines.length - 1) * 15) * k;
      // Only the caption moves to fit the viewport; the pin stays at the actual node.
      const left = bounded ? Math.max(bounds.left, Math.min(x - w / 2, bounds.right - w)) : x - w / 2;
      const dx = left + w / 2 - x;
      const edgeX = Math.max(left - x, Math.min(0, left + w - x));
      const leader = Math.abs(dx) > .01 * k ? `<path d="M0 ${-4.5 * k}L${edgeX} ${-7 * k}" fill="none" stroke="${fill}" stroke-width="${1.5 * k}"/>` : '';
      const caption = lines.map((line, i) => `<tspan x="${dx}" dy="${i ? 15 * k : 0}">${svgText(line)}${i < lines.length - 1 ? ' ' : ''}</tspan>`).join('');
      return {
        svg: `<g transform="translate(${x} ${y})" role="img" aria-label="${svgText(text).replace(/"/g, '&quot;')}">${leader}<rect x="${left - x}" y="${-h - 7 * k}" width="${w}" height="${h}" rx="${11 * k}" fill="${fill}"/><text x="${dx}" y="${-h + 8.3 * k}" font-size="${12 * k}" font-weight="700" fill="#fff" text-anchor="middle">${caption}</text><circle r="${4.5 * k}" fill="${fill}" stroke="#fff" stroke-width="${1.5 * k}"/></g>`,
        box: [left - 2 * k, y - h - 9 * k, left + w + 2 * k, y - 5 * k],
        pinBox: [x - 6 * k, y - 6 * k, x + 6 * k, y + 6 * k],
      };
    };
    const tags = [[end, node(end).kind === 'room' ? doorNo(node(end)) : label(end), 'var(--dest)']];
    if (start !== end && (node(start).f === cur.f || node(start).f === cur.from)) tags.unshift([start, node(start).kind === 'entrance' ? t('nav.entry') : t('nav.start'), 'var(--ink)']);
    for (const [id, text, fill] of tags) {
      const rendered = tag(id, text, fill);
      s += rendered.svg;
      if (node(id).f === cur.f) taken.push(rendered.box, rendered.pinBox);
    }
    // Rooms to look for whose number didn't fit on their block: blue for "you're on track", grey for "wrong way".
    // A tag goes below, above, right or left of the room, or is left out (the card still lists every room).
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const door = (id, text, ink, edge) => {
      const [x, y] = at(id), w = (textWidth(text, 11, 800) + 12) * k, h = 18 * k;
      for (const [dx, dy] of [[-w / 2, 6 * k], [-w / 2, -h - 6 * k], [8 * k, -h / 2], [-w - 8 * k, -h / 2]]) {
        const box = [x + dx - 2 * k, y + dy - 2 * k, x + dx + w + 2 * k, y + dy + h + 2 * k];
        if (taken.some(t => hit(t, box))) continue;
        taken.push(box);
        return `<g transform="translate(${x} ${y})"><rect x="${dx}" y="${dy}" width="${w}" height="${h}" rx="${5 * k}" fill="#fff" stroke="${edge}" stroke-width="${1.5 * k}"/><text x="${dx + w / 2}" y="${dy + h / 2 + 4 * k}" font-size="${11 * k}" font-weight="800" fill="${ink}" text-anchor="middle">${text}</text><circle r="${2.6 * k}" fill="${edge}"/></g>`;
      }
      return '';
    };
    const checks = (cur.checks || []).filter(id => loose.includes(id));
    // wrong-way warning first, then where this step ends, then the first room you pass, then the rest
    const order = [checks[checks.length - 1], checks[0]].filter(Boolean);
    if (loose.includes(cur.wrong)) s += door(cur.wrong, `✕ ${doorNo(node(cur.wrong))}`, 'var(--muted)', 'var(--bldg-edge)');
    for (const id of [...new Set([...order, ...checks])]) s += door(id, doorNo(node(id)), 'var(--route)', 'var(--route)');
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
      const a = connectorAnchor(cur) || node(cur.ids[0]);
      for (const f of [cur.from, cur.f]) for (const [dx, dy] of [[-22, -22], [22, -22], [22, 22], [-22, 22]]) pts.push(iso(a.x + dx, a.y + dy, zOf(f)));
      return pts;
    }
    // walking: close in on this stretch of corridor so the room tags along it have room to breathe
    const z = zOf(cur.f);
    for (const n of cur.ids.map(node)) for (const [dx, dy] of [[-16, -16], [16, -16], [16, 16], [-16, 16]]) pts.push(iso(n.x + dx, n.y + dy, z));
    return pts;
  }

  return { node, label, floorName, floorText, parseRoom, route, buildSteps, drawIso, viewBounds };
})();
