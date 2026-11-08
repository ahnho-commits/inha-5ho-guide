'use strict';
// Outdoor wayfinding to 5호관. Map units are metres (x east, y south) from campus-data.js.
// Location never leaves this page: no fetch, no storage, nothing in the URL.

const C = CAMPUS;
const $ = id => document.getElementById(id);
const svg = $('map');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const project = (lat, lon) => [(lon - C.origin[1]) * C.kx, -(lat - C.origin[0]) * C.ky];

const STARTS = {
  station: { title: '인하대역', sub: '4번 출구 · 운동장 남쪽·동쪽으로 돌아가는 길' },
  main: { title: '정문', sub: '' },
  back: { title: '후문', sub: '' },
  side: { title: '쪽문', sub: '60주년기념관 옆 작은 문' },
};
const WALK = 1.2;          // m/s, for the minutes estimate
const ARRIVE_M = 12;
const OFF_ROUTE_M = 25;
const NEAR_KM = 3;         // closer than this: keep watching and start on its own once on campus

// ---------- path graph ----------
const N = C.nodes;
const adj = N.map(() => []);
const kinds = new Map();
const ekey = (a, b) => a < b ? a + ',' + b : b + ',' + a;
for (const [a, b, k] of C.edges) {
  const w = dist(N[a], N[b]);
  adj[a].push([b, w]);
  adj[b].push([a, w]);
  kinds.set(ekey(a, b), k);
}

function nearestOnSegment(p, A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / L)) : 0;
  const q = [A[0] + dx * t, A[1] + dy * t];
  return { q, t, d: dist(p, q) };
}

function snap(p) {
  let best = null;
  for (const [a, b] of C.edges) {
    const r = nearestOnSegment(p, N[a], N[b]);
    if (!best || r.d < best.d) best = { ...r, a, b };
  }
  return best;
}

function shortest(sources, target) {
  const D = new Float64Array(N.length).fill(Infinity), prev = new Int32Array(N.length).fill(-1), heap = [];
  const push = (d, n) => {
    heap.push([d, n]);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const [n, d] of sources) if (d < D[n]) { D[n] = d; push(d, n); }
  while (heap.length) {
    const [d, u] = pop();
    if (d > D[u]) continue;
    if (u === target) break;
    for (const [v, w] of adj[u]) if (d + w < D[v]) { D[v] = d + w; prev[v] = u; push(d + w, v); }
  }
  if (!isFinite(D[target])) return null;
  const path = [target];
  while (prev[path[0]] !== -1) path.unshift(prev[path[0]]);
  return path;
}

// ---------- route + instructions ----------
const LANDMARKS = [
  // OSM also has a mislabeled "5호관" elsewhere on campus; only the real one (main) keeps that name.
  ...C.buildings.filter(b => b.name && (b.main || b.name !== '5호관')).map(b => ({ name: b.name, p: centroid(b.p) })),
  ...C.pitches.filter(p => p.name).map(p => ({ name: p.name, p: centroid(p.p) })),
  ...Object.entries(C.pois).filter(([k]) => k.startsWith('start:')).map(([, v]) => ({ name: v.name, p: v.p })),
];
function centroid(ring) {
  const n = ring.length;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

function buildRoute(from, destKey, startName) {
  const dest = C.pois['dest:' + destKey];
  const s = snap(from);
  // From the station people walk the south and east sides of the field, not the shortest line.
  const vias = dist(from, C.pois['start:station'].p) < 80 ? C.vias.station : [];
  let path = shortest([[s.a, dist(s.q, N[s.a])], [s.b, dist(s.q, N[s.b])]], vias.length ? vias[0] : dest.node);
  for (let i = 0; path && i < vias.length; i++) {
    const leg = shortest([[vias[i], 0]], i + 1 < vias.length ? vias[i + 1] : dest.node);
    path = leg && path.concat(leg.slice(1));
  }
  if (!path) return null;
  const pts = [s.q], segKind = [];
  const firstKind = kinds.get(ekey(s.a, s.b)) || 0;
  path.forEach((n, i) => {
    const prevKind = i === 0 ? firstKind : kinds.get(ekey(path[i - 1], n)) || 0;
    if (dist(pts[pts.length - 1], N[n]) < 0.5) return;
    pts.push(N[n]);
    segKind.push(prevKind);
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const r = { pts, segKind, cum, total: cum[cum.length - 1], dest: destKey, destName: dest.name, startName, from };
  r.steps = buildSteps(r);
  return r;
}

function pointAt(r, s) {
  s = Math.max(0, Math.min(r.total, s));
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const a = r.pts[i - 1], b = r.pts[i], L = r.cum[i] - r.cum[i - 1];
  const t = L ? (s - r.cum[i - 1]) / L : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
const bearing = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;

function kindAt(r, s) {
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] <= s) i++;
  return r.segKind[i - 1] || 0;
}

function buildSteps(r) {
  // Look ~10 m back and ahead so OSM zig-zags don't read as turns.
  const turns = [];
  for (let i = 1; i < r.pts.length - 1; i++) {
    const s = r.cum[i];
    if (s < 8 || r.total - s < 8) continue;
    let d = bearing(pointAt(r, s - 10), r.pts[i]) - bearing(r.pts[i], pointAt(r, s + 10));
    d = -(((d + 540) % 360) - 180);   // signed turn, + = clockwise = right on a north-up map
    if (Math.abs(d) < 35) continue;
    const last = turns[turns.length - 1];
    if (last && s - last.at < 15) { if (Math.abs(d) > Math.abs(last.turn)) { last.at = s; last.turn = d; last.p = r.pts[i]; } continue; }
    turns.push({ at: s, turn: d, p: r.pts[i] });
  }
  const steps = [{ at: 0, dir: 'start', text: `${r.startName}에서 출발` }];
  for (const t of turns) {
    const dir = t.turn > 0 ? (t.turn < 60 ? 'slight-right' : 'right') : (t.turn > -60 ? 'slight-left' : 'left');
    const word = { right: '오른쪽으로', 'slight-right': '살짝 오른쪽으로', left: '왼쪽으로', 'slight-left': '살짝 왼쪽으로' }[dir];
    // The place you just left is no help as a landmark ("후문 앞에서" right after leaving 후문).
    const lm = LANDMARKS.filter(l => dist(l.p, t.p) < 60 && dist(l.p, r.from) > 40).sort((a, b) => dist(a.p, t.p) - dist(b.p, t.p))[0];
    const next = kindAt(r, t.at + 1);
    let text = `${lm ? lm.name + ' 앞에서 ' : ''}${word} 가세요`;
    if (next === 1) text = `운동장 바깥쪽 길을 따라 ${word}`;
    steps.push({ at: t.at, dir, text, p: t.p });
  }
  steps.push({ at: r.total, dir: 'arrive', text: `${r.destName} 도착`, p: r.pts[r.pts.length - 1] });
  // Flag a step when the walk leading up to it uses a path we added from the user's description.
  steps.forEach((st, i) => { if (i) st.guess = r.segKind.some((k, j) => k === 2 && r.cum[j] < st.at && r.cum[j + 1] > steps[i - 1].at); });
  return steps;
}

// ---------- 3D map view ----------
// Fixed-angle isometric view. The map is turned 29° so 5호관 sits square on screen, the same way
// the indoor floors are drawn (5남 bottom-left, 5동 bottom-right). Screen units are about a metre.
const ROT = -29 * Math.PI / 180, RC = Math.cos(ROT), RS = Math.sin(ROT);
const turn = p => [p[0] * RC - p[1] * RS, p[0] * RS + p[1] * RC];
function S(p, z = 0) {
  const [x, y] = turn(p);
  return [(x - y) * 0.866, (x + y) * 0.5 - z];
}
const pts = (arr, z = 0) => arr.map(p => S(p, z).map(v => v.toFixed(1)).join(',')).join(' ');
const pathOf = (arr, z = 0) => 'M' + arr.map(p => S(p, z).map(v => v.toFixed(1)).join(' ')).join('L');

const view = { x: 0, y: 0, w: 600 };
let follow = false, viewAnim = 0;
const aspect = () => svg.clientHeight / svg.clientWidth;
const mPerPx = () => view.w / svg.clientWidth;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Glide the camera to a new view; panning by hand cancels the glide.
function goView(target, animate = true) {
  cancelAnimationFrame(viewAnim);
  if (!animate || reduceMotion) { Object.assign(view, target); return draw(); }
  const from = { ...view }, t0 = performance.now(), D = 450;
  const tick = now => {
    const t = Math.min(1, (now - t0) / D), e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    for (const k of ['x', 'y', 'w']) view[k] = from[k] + (target[k] - from[k]) * e;
    draw();
    if (t < 1) viewAnim = requestAnimationFrame(tick);
  };
  viewAnim = requestAnimationFrame(tick);
}
// Fit screen-space points so they stay clear of the top card and the bottom sheet.
function fitScreen(points, padPx = 40, minSpan = 60) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const top = $('instr').hidden ? 70 : 190, bottom = visibleSheetHeight() + 20;
  const Wpx = svg.clientWidth, Hpx = svg.clientHeight;
  const spanX = Math.max(...xs) - Math.min(...xs) || 60, spanY = Math.max(...ys) - Math.min(...ys) || 60;
  const usableW = Wpx - padPx * 2, usableH = Math.max(120, Hpx - top - bottom - padPx);
  const m = Math.max(spanX / usableW, spanY / usableH, minSpan / Wpx);
  const w = Math.min(1600, m * Wpx);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  goView({ w, x: cx - w / 2, y: cy - (top + (Hpx - top - bottom) / 2) * (w / Wpx) });
}
const fit = (points, padPx, minSpan) => fitScreen(points.map(p => S(p)), padPx, minSpan);
function visibleSheetHeight() {
  const s = [...document.querySelectorAll('.sheet')].find(el => !el.hidden);
  return s ? s.offsetHeight : 0;
}

// --- the static 3D campus, built once ---
const ROAD_W = { secondary: 14, secondary_link: 9, trunk: 18, tertiary: 10, residential: 7, unclassified: 7, service: 5.5, pedestrian: 5, footway: 3, path: 2.5, steps: 3 };
const MAX_H = 34;   // tall towers are capped so they don't bury the campus
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const solid = (b, p) => inRing(p, b.p) && !(b.hole && inRing(p, b.hole));

function buildingSvg(b) {
  const h = Math.min(MAX_H, (b.lv || 3) * 3.4);
  const [top, side, side2] = b.main ? ['var(--main-top)', 'var(--main-side)', 'var(--main-side2)'] : ['var(--b-top)', 'var(--b-side)', 'var(--b-side2)'];
  const walls = [];
  for (const ring of b.hole ? [b.p, b.hole] : [b.p]) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], c = ring[i], L = dist(a, c);
      if (L < 0.3) continue;
      // which side of this wall is open air? that is the side we might see
      let nx = (c[1] - a[1]) / L, ny = -(c[0] - a[0]) / L;
      const mid = [(a[0] + c[0]) / 2 + nx * .6, (a[1] + c[1]) / 2 + ny * .6];
      if (solid(b, mid)) { nx = -nx; ny = -ny; }
      const [tx, ty] = turn([nx, ny]);
      if (tx + ty <= 0) continue;             // faces away from the camera
      walls.push({ d: (S(a)[1] + S(c)[1]) / 2, s: `<polygon fill="${ty > tx ? side : side2}" points="${pts([a, c], h)} ${pts([c, a], 0)}"/>` });
    }
  }
  walls.sort((p, q) => p.d - q.d);
  const roof = `<path fill-rule="evenodd" fill="${top}" stroke="var(--b-line)" stroke-width=".5" d="${pathOf(b.p, h)}Z${b.hole ? pathOf(b.hole, h) + 'Z' : ''}"/>`;
  return walls.map(w => w.s).join('') + roof;
}

const BASE3D = (() => {
  const [x0, y0, x1, y1] = C.area;
  let s = `<polygon fill="var(--ground)" points="${pts([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])}"/>`;
  s += C.pitches.map(p => `<polygon fill="var(--pitch)" stroke="var(--pitch-edge)" stroke-width=".6" points="${pts(p.p)}"/>`).join('');
  s += `<path fill="none" stroke="var(--track)" stroke-width="3" stroke-linejoin="round" d="${pathOf(C.track)}Z"/>`;
  const roads = [...C.roads].sort((a, b) => (ROAD_W[a.t] || 4) - (ROAD_W[b.t] || 4));
  s += roads.map(r => `<path d="${pathOf(r.p)}" fill="none" stroke="var(--road-edge)" stroke-linecap="round" stroke-linejoin="round" stroke-width="${((ROAD_W[r.t] || 4) + 1.6) * .8}"/>`).join('');
  s += roads.map(r => `<path d="${pathOf(r.p)}" fill="none" stroke="var(--road)" stroke-linecap="round" stroke-linejoin="round" stroke-width="${(ROAD_W[r.t] || 4) * .8}"/>`).join('');
  // Back to front: anything lower on screen is nearer the camera and drawn later.
  const items = C.buildings.map((b, i) => ({ d: Math.max(...b.p.map(p => S(p)[1])), s: `<g class="bldg" data-b="${i}">${buildingSvg(b)}</g>` }))
    .sort((a, b) => a.d - b.d);
  return s + items.map(i => i.s).join('');
})();

// Each building's outline on screen (roof and footprint together), so we can tell which ones hide the route.
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const SHADOWS = C.buildings.map(b => {
  const h = Math.min(MAX_H, (b.lv || 3) * 3.4);
  return hull(b.p.flatMap(p => [S(p, 0), S(p, h)]));
});
// Fade every building that stands between the camera and the route, so the whole path stays visible.
let xrayFor = null;
function applyXray() {
  if (xrayFor === route) return;
  xrayFor = route;
  const hide = new Set();
  if (route) {
    for (let s = 0; s <= route.total; s += 4) {
      const q = S(pointAt(route, s));
      SHADOWS.forEach((poly, i) => { if (!hide.has(i) && inRing(q, poly)) hide.add(i); });
    }
  }
  for (const g of document.querySelectorAll('#base .bldg')) g.classList.toggle('xray', hide.has(+g.dataset.b));
}

let route = null, me = null, heading = null, focusStep = null;
let progress = 0;
let baseShown = null;

function pill(p, z, text, fill, k) {
  const [x, y] = S(p, z), fs = 13 * k, w = (text.length * 13 + 20) * k, h = 26 * k;
  return `<g transform="translate(${x} ${y})"><rect x="${-w / 2}" y="${-h - 9 * k}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/><text y="${-9 * k - h / 2 + fs * .36}" font-size="${fs}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text><circle r="${4.5 * k}" fill="${fill}" stroke="#fff" stroke-width="${1.8 * k}"/></g>`;
}
const LIFT = .4;   // draw the route a hair above the ground

function draw() {
  const k = mPerPx(), h = view.w * aspect();
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${h}`);
  if (phase === 'indoor') {
    if (baseShown !== 'indoor') { $('base').innerHTML = ''; baseShown = 'indoor'; }
    $('over').innerHTML = `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${h}" fill="var(--ground)"/>` + Indoor.drawIso(k, plan, inStep);
    return;
  }
  if (baseShown !== 'outdoor') { $('base').innerHTML = BASE3D; baseShown = 'outdoor'; xrayFor = undefined; }
  applyXray();
  let s = '';
  if (route) {
    const doneTo = Math.min(progress, route.total), done = [], rest = [];
    route.pts.forEach((p, i) => (route.cum[i] <= doneTo ? done : rest).push(p));
    const cut = pointAt(route, doneTo);
    done.push(cut);
    rest.unshift(cut);
    const sw = 7 * k;
    if (done.length > 1) s += `<path d="${pathOf(done, LIFT)}" fill="none" stroke="var(--done)" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<path d="${pathOf(rest, LIFT)}" fill="none" stroke="var(--route-case)" stroke-width="${sw + 5 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<path d="${pathOf(rest, LIFT)}" fill="none" stroke="var(--route)" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<path d="${pathOf(rest, LIFT)}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="${2.2 * k}" stroke-linecap="round" stroke-dasharray="${1 * k} ${13 * k}"><animate attributeName="stroke-dashoffset" from="0" to="${-14 * k}" dur="1.1s" repeatCount="indefinite"/></path>`;
    if (focusStep && focusStep.p) {
      const [fx, fy] = S(focusStep.p);
      s += `<ellipse cx="${fx}" cy="${fy}" rx="${15 * k}" ry="${9 * k}" fill="none" stroke="var(--dest)" stroke-width="${3 * k}"/>`;
    }
  }
  for (const l of LANDMARKS.filter(l => C.buildings.some(b => b.name === l.name && (b.main || l.name !== '5호관')))) {
    const b = C.buildings.find(b => b.name === l.name && (b.main || l.name !== '5호관'));
    const [x, y] = S(l.p, Math.min(MAX_H, (b.lv || 3) * 3.4));
    const big = b.main;
    s += `<text class="lbl" x="${x}" y="${y}" font-size="${(big ? 16 : 12) * k}" font-weight="${big ? 800 : 600}" fill="${big ? 'var(--dest)' : 'var(--muted)'}" stroke-width="${3.5 * k}" text-anchor="middle">${l.name}</text>`;
  }
  for (const [key, v] of Object.entries(C.pois)) {
    if (key.startsWith('start:')) s += pill(v.p, 0, key === 'start:station' ? '인하대역' : v.name, 'var(--ink)', k);
  }
  const d = C.pois['dest:' + (route ? route.dest : selectedDest)];
  s += pill(d.p, 0, d.name.replace(' 주출입구', ''), 'var(--dest)', k);
  if (me) {
    const [mx, my] = S(me.p), r = Math.max(me.acc, 3 * k);
    s += `<ellipse cx="${mx}" cy="${my}" rx="${r * 1.2247}" ry="${r * .7071}" fill="var(--me)" fill-opacity=".14" stroke="var(--me)" stroke-opacity=".35" stroke-width="${k}"/>`;
    if (heading !== null) {
      // compass heading (0 = north, clockwise) turned into an angle on this rotated, tilted map
      const rad = heading * Math.PI / 180, ahead = S([me.p[0] + Math.sin(rad) * 30, me.p[1] - Math.cos(rad) * 30]);
      const ang = Math.atan2(ahead[0] - mx, -(ahead[1] - my)) * 180 / Math.PI;
      s += `<path transform="translate(${mx} ${my}) rotate(${ang})" d="M0 0 L${-14 * k} ${-34 * k} A36 36 0 0 1 ${14 * k} ${-34 * k} Z" fill="var(--me)" fill-opacity=".3"/>`;
    }
    s += `<circle cx="${mx}" cy="${my}" r="${8 * k}" fill="var(--me)" stroke="#fff" stroke-width="${3 * k}"/>`;
  }
  $('over').innerHTML = s;
}

// ---------- gestures ----------
const pointers = new Map();
let pinch = null;
function stopFollow() {
  if (follow) { follow = false; $('recenter').hidden = !me; }
}
svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); cancelAnimationFrame(viewAnim); });
svg.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId), cur = [e.clientX, e.clientY];
  pointers.set(e.pointerId, cur);
  const k = mPerPx();
  if (pointers.size === 1) {
    if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) < 0.5) return;
    stopFollow();
    view.x -= (cur[0] - prev[0]) * k;
    view.y -= (cur[1] - prev[1]) * k;
    draw();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const span = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch / span);
    pinch = span;
  }
});
const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
function zoomAt(px, py, f) {
  cancelAnimationFrame(viewAnim);
  const r = svg.getBoundingClientRect(), k = mPerPx();
  const mx = view.x + (px - r.left) * k, my = view.y + (py - r.top) * k;
  const w = Math.max(50, Math.min(1600, view.w * f)), k2 = w / svg.clientWidth;
  view.w = w;
  view.x = mx - (px - r.left) * k2;
  view.y = my - (py - r.top) * k2;
  if (follow && me) centerOnMe(); else draw();
}
$('zoom-in').onclick = () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1 / 1.5);
$('zoom-out').onclick = () => zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.5);
$('recenter').onclick = () => { follow = true; $('recenter').hidden = true; centerOnMe(); };
function centerOnMe() {
  const h = view.w * aspect(), [mx, my] = S(me.p);
  view.x = mx - view.w / 2;
  view.y = my - h * 0.62;   // keep the dot below the instruction card
  draw();
}

// ---------- screens ----------
let selectedDest = 'south', mode = null;
// target: the indoor node we are heading for. phase: outdoor map or indoor floor plan.
let target = null, phase = 'outdoor', plan = null, inStep = 0, indoorFrom = null;
const SHEETS = ['s-start', 's-ask', 's-denied', 's-manual', 's-route', 's-nav', 's-far', 's-inside', 's-indoor'];
function sheet(id) {
  for (const s of SHEETS) $(s).hidden = s !== id;
  placeFabs();
}
function placeFabs() {
  $('fabs').style.bottom = (visibleSheetHeight() + 12) + 'px';
}
function banner(text, btn, onBtn) {
  $('banner').hidden = !text;
  $('banner-text').textContent = text || '';
  $('banner-btn').hidden = !btn;
  $('banner-btn').textContent = btn || '';
  $('banner-btn').onclick = onBtn || null;
}

const ICONS = {
  start: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  straight: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  right: '<path d="M6 20v-7a4 4 0 0 1 4-4h9M14 4l5 5-5 5"/>',
  left: '<path d="M18 20v-7a4 4 0 0 0-4-4H5M10 4L5 9l5 5"/>',
  'slight-right': '<path d="M8 20V12l9-8M10 4h7v7"/>',
  'slight-left': '<path d="M16 20V12L7 4M14 4H7v7"/>',
  arrive: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  up: '<path d="M4 20h5v-5h5v-5h5V5M15 5h4v4"/>',
  down: '<path d="M4 5h5v5h5v5h5v5M19 16v4h-4"/>',
  x: '<path d="M5 19L19 5M5 5l14 14"/>',
};
const iconSvg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.straight}</svg>`;
function showInstr(step, distM) {
  $('instr').hidden = false;
  $('i-icon').innerHTML = iconSvg(step.dir);
  $('i-dist').textContent = step.dir === 'arrive' && distM < ARRIVE_M ? '도착' : `${Math.max(0, Math.round(distM / 5) * 5)}m`;
  $('i-say').textContent = step.text + (step.guess ? ' (경로 확인 중)' : '');
  const remain = route.total - progress;
  $('i-to').textContent = `${route.destName}까지 ${Math.round(remain)}m`;
  $('i-eta').textContent = `도보 ${Math.max(1, Math.ceil(remain / WALK / 60))}분`;
}
function nextStepFrom(s) {
  return route.steps.find(st => st.at > s + 3) || route.steps[route.steps.length - 1];
}

// ---------- destination (an indoor node) ----------
const TOWER_FLOORS = [6, 7, 8, 9, 10];
function setTarget(tg) {
  target = tg;
  for (const id of ['go-gps', 'go-manual', 'go-inside']) $(id).disabled = !target;
}
function renderQuick() {
  $('quick').innerHTML = [['B1:clubs', t('quick_b1')], ['tower', t('quick_tower') + ' ' + t('quick_tower_sub')]]
    .map(([id, text]) => `<button class="mini" data-quick="${id}" aria-pressed="${!!target && (target.id === id || (id === 'tower' && target.id.startsWith('T:')))}">${text}</button>`).join('');
  $('tower-floors').innerHTML = TOWER_FLOORS.map(f => `<button class="mini" data-tower="${f}" aria-pressed="${!!target && target.id === 'T:' + f}">${Indoor.label('T:' + f)}</button>`).join('');
}
// Typed room -> a hint line, and buttons when it could be more than one room.
function readRoom(inputId, hintId, candsId, pick) {
  const text = $(inputId).value.trim(), hint = $(hintId), cands = $(candsId);
  cands.innerHTML = '';
  if (!text) { hint.textContent = ''; return pick(null); }
  const r = Indoor.parseRoom(text);
  if (!r) { hint.className = 'hint bad'; hint.textContent = t('room_unknown'); return pick(null); }
  if (r.candidates) {
    hint.className = 'hint'; hint.textContent = r.note;
    cands.innerHTML = r.candidates.map(c => `<button class="mini" data-cand="${c.id}" data-for="${candsId}">${c.label}</button>`).join('');
    cands._list = r.candidates;
    return pick(null);
  }
  if (!r.id) { hint.className = 'hint bad'; hint.textContent = t('room_missing_none', { label: r.label }); return pick(null); }
  hint.className = r.missing ? 'hint bad' : 'hint ok';
  hint.textContent = r.missing ? t('room_missing', { label: r.label, near: r.near }) : [r.decode, r.note].filter(Boolean).join(' · ');
  pick({ id: r.id, label: r.label });
}
function onRoomInput() {
  $('tower-floors').hidden = true;
  readRoom('room', 'room-hint', 'room-cands', setTarget);
  renderQuick();
}
function chooseCandidate(b) {
  const box = $(b.dataset.for), c = box._list.find(x => x.id === b.dataset.cand);
  for (const x of box.children) x.setAttribute('aria-pressed', x === b);
  const hint = $(b.dataset.for === 'room-cands' ? 'room-hint' : 'near-hint');
  hint.className = 'hint ok';
  hint.textContent = c.decode;
  if (b.dataset.for === 'room-cands') { setTarget({ id: c.id, label: c.label }); renderQuick(); }
  else { insideNear = c.id; renderInsidePicks(); }
}
// The entrance that makes the whole walk shortest: outdoor metres plus the indoor route.
function pickEntrance(from) {
  let best = null;
  for (const key of ['south', 'corner', 'east']) {
    const out = buildRoute(from, key, '');
    const ind = Indoor.route('ENT:' + key, target.id, { nw: $('nw').checked });
    if (!out || !ind) continue;
    const total = out.total + ind.cost * 6;
    if (!best || total < best.total) best = { key, total };
  }
  return best ? best.key : 'south';
}
function renderStarts() {
  $('starts').innerHTML = Object.entries(STARTS).map(([k, d]) => `<button class="chip" data-start="${k}"><b>${d.title}</b>${d.sub ? `<span>${d.sub}</span>` : ''}</button>`).join('');
}

function reset() {
  phase = 'outdoor';
  plan = null;
  stopGPS();
  stopSim();
  route = null; me = null; heading = null; focusStep = null; progress = 0; mode = null;
  $('instr').hidden = true;
  $('recenter').hidden = true;
  $('compass').hidden = true;
  $('sim-badge').hidden = true;
  banner('');
  sheet('s-start');
  overview();
}
function overview() {
  const pts = route ? route.pts : Object.values(C.pois).map(v => v.p);
  fit(me ? [...pts, me.p] : pts);
}

// ---------- GPS ----------
let watchId = null, offCount = 0, gotFix = false;
function startGPS() {
  if (!('geolocation' in navigator)) return denied('이 브라우저는 위치 기능을 지원하지 않아요.', []);
  mode = 'gps';
  gotFix = false;
  sheet('s-nav');
  banner('위치 찾는 중… 하늘이 보이는 곳에서 더 빨라요');
  $('compass').hidden = false;
  watchId = navigator.geolocation.watchPosition(onPos, onPosError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}
function stopGPS() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
document.addEventListener('visibilitychange', () => {
  if (mode !== 'gps') return;
  if (document.hidden) stopGPS();
  else if (watchId === null) watchId = navigator.geolocation.watchPosition(onPos, onPosError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
});
function onPos(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const p = project(latitude, longitude);
  gotFix = true;
  if (!inArea(p, 150)) return outsideArea(latitude, longitude);
  handleFix(p, accuracy);
}
// Great-circle distance, so someone opening this abroad still gets a sensible number.
function kmToCampus(lat, lon) {
  const d = C.pois['dest:south'].p;
  const lat2 = C.origin[0] - d[1] / C.ky, lon2 = C.origin[1] + d[0] / C.kx;
  const r = Math.PI / 180, a = Math.sin((lat2 - lat) * r / 2) ** 2 + Math.cos(lat * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon) * r / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
function outsideArea(lat, lon) {
  const km = kmToCampus(lat, lon);
  const far = km < 1 ? `${Math.round(km * 100) * 10}m` : `${km.toFixed(1)}km`;
  route = null;
  me = null;
  $('instr').hidden = true;
  if (km <= NEAR_KM) {
    banner(`인하대까지 약 ${far}예요. 캠퍼스 가까이 오면 자동으로 안내가 시작돼요.`, '출발지 고르기', toManual);
    fit(Object.values(C.pois).map(v => v.p));
    return;
  }
  stopGPS();
  mode = null;
  banner('');
  $('compass').hidden = true;
  $('far-dist').textContent = km < 100 ? `지금 위치에서 인하대까지 약 ${far}예요.` : '지금 위치는 인하대에서 100km 넘게 떨어져 있어요.';
  sheet('s-far');
  fit(Object.values(C.pois).map(v => v.p));
}
function onPosError(err) {
  if (err.code === 1) {
    stopGPS();
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    denied('위치 권한이 꺼져 있어요. 다시 켜려면:', ios
      ? ['주소창 왼쪽 <b>가가</b> → 웹사이트 설정 → 위치 → <b>허용</b>', '그래도 안 되면 설정 → 개인정보 보호 및 보안 → 위치 서비스 → <b>Safari 웹사이트</b>를 "앱을 사용하는 동안"으로', '바꾼 뒤 이 페이지를 새로고침']
      : ['주소창 왼쪽 아이콘 → <b>권한</b> → 위치 <b>허용</b>', '폰 설정에서 위치가 켜져 있는지 확인', '바꾼 뒤 이 페이지를 새로고침']);
  } else if (!gotFix) {
    stopGPS();
    denied('위치를 찾지 못했어요. 실내이거나 신호가 약할 수 있어요.', ['건물 밖, 하늘이 보이는 곳에서 다시 시도해 보세요', '또는 출발지를 직접 고를 수 있어요']);
  }
}
function denied(why, steps) {
  mode = null;
  $('denied-why').textContent = why;
  $('denied-steps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  banner('');
  sheet('s-denied');
}

function inArea(p, margin) {
  const [x0, y0, x1, y1] = C.area;
  return p[0] > x0 - margin && p[0] < x1 + margin && p[1] > y0 - margin && p[1] < y1 + margin;
}

function handleFix(p, acc) {
  gotFix = true;
  me = { p, acc };
  if (mode === 'gps') {
    if (acc > 300) banner(`위치가 많이 부정확해요 (±${Math.round(acc)}m). '정확한 위치'가 꺼져 있을 수 있어요.`, '출발지 고르기', toManual);
    else if (acc > 50) banner(`위치가 부정확해요 (±${Math.round(acc)}m). 건물에서 떨어지면 나아져요.`);
    else banner('');
  }
  if (!route) {
    selectedDest = pickEntrance(p);
    route = buildRoute(p, selectedDest, '지금 위치');
    progress = 0;
    follow = true;
    overview();
    setTimeout(() => { if (follow && me) centerOnMe(); }, 1200);
  }
  updateProgress(p, acc);
}

function updateProgress(p, acc) {
  let best = null;
  for (let i = 1; i < route.pts.length; i++) {
    const r = nearestOnSegment(p, route.pts[i - 1], route.pts[i]);
    const s = route.cum[i - 1] + r.t * (route.cum[i] - route.cum[i - 1]);
    const score = r.d + (s < progress - 30 ? 1000 : 0);   // don't jump backwards along the route
    if (!best || score < best.score) best = { score, d: r.d, s };
  }
  if (best.d > Math.max(OFF_ROUTE_M, acc)) {
    if (++offCount >= 3 && mode !== 'sim') {
      offCount = 0;
      route = buildRoute(p, selectedDest, '지금 위치');
      progress = 0;
      if (navigator.vibrate) navigator.vibrate(120);
      banner('경로를 벗어나서 다시 찾았어요');
      setTimeout(() => banner(''), 3000);
      return updateProgress(p, acc);
    }
  } else offCount = 0;
  progress = Math.max(progress, best.s);
  const remain = route.total - progress;
  if (remain < ARRIVE_M) return arrive();
  const st = nextStepFrom(progress);
  showInstr(st, st.at - progress);
  if (follow) centerOnMe(); else draw();
}

function arrive() {
  stopGPS();
  stopSim();
  progress = route.total;
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  // Outside leg done: carry straight on with the floors inside.
  enterIndoor('ENT:' + route.dest);
  banner(t('arrived_banner', { entrance: C.pois['dest:' + route.dest].name }));
  setTimeout(() => banner(''), 4000);
}

// ---------- compass ----------
async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return banner('방향 표시 권한이 없어서 지도만 보여드려요.');
    }
  } catch { return banner('방향 표시를 켤 수 없어요. 지도는 그대로 쓸 수 있어요.'); }
  const onTurn = e => {
    const h = e.webkitCompassHeading ?? (e.absolute && e.alpha !== null ? 360 - e.alpha : null);
    if (h === null) return;
    heading = h;
    draw();
  };
  window.addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onTurn);
  $('compass').hidden = true;
}
$('compass').onclick = enableCompass;

// ---------- manual start + simulation ----------
let stepIdx = 0, simTimer = null;
function toManual() {
  stopGPS();
  mode = 'manual';
  me = null;
  route = null;
  banner('');
  $('instr').hidden = true;
  $('compass').hidden = true;
  sheet('s-manual');
  overview();
}
function startManual(key) {
  const start = C.pois['start:' + key];
  selectedDest = pickEntrance(start.p);
  route = buildRoute(start.p, selectedDest, start.name);
  progress = 0;
  stepIdx = 0;
  focusStep = null;
  $('route-title').textContent = `${STARTS[key].title} → ${route.destName}`;
  $('route-sub').textContent = `약 ${Math.round(route.total / 10) * 10}m · 도보 ${Math.max(1, Math.ceil(route.total / WALK / 60))}분 · 안내 ${route.steps.length - 1}번`;
  sheet('s-route');
  showManualStep();
}
function showManualStep() {
  const st = route.steps[Math.min(stepIdx + 1, route.steps.length - 1)];
  const from = route.steps[stepIdx];
  progress = from.at;
  focusStep = st;
  showInstr(st, st.at - from.at);
  $('prev-step').disabled = stepIdx === 0;
  $('next-step').textContent = stepIdx >= route.steps.length - 2 ? t('indoor_go') : '다음 안내';
  const seg = route.pts.filter((_, i) => route.cum[i] >= from.at - 1 && route.cum[i] <= st.at + 1);
  fit([pointAt(route, from.at), ...seg, pointAt(route, st.at)], 50, 200);
}
$('next-step').onclick = () => {
  // Last outdoor step: at the entrance, so carry on inside.
  if (stepIdx >= route.steps.length - 2) return enterIndoor('ENT:' + route.dest);
  stepIdx++;
  showManualStep();
};
$('prev-step').onclick = () => { if (stepIdx > 0) { stepIdx--; showManualStep(); } };

function startSim() {
  mode = 'sim';
  focusStep = null;
  progress = 0;
  me = null;
  follow = true;
  $('sim-badge').hidden = false;
  sheet('s-nav');
  let s = 0;
  simTimer = setInterval(() => {
    s += 6 * 0.3;     // brisk walk, sped up for demos
    handleFix(pointAt(route, s), 6);
  }, 300);
}
function stopSim() {
  clearInterval(simTimer);
  simTimer = null;
}
$('simulate').onclick = startSim;

// ---------- indoor ----------
const CENTRAL = { S: '5남 중앙 계단', E: '5동 중앙 계단', N: '5북 동쪽 중앙 계단', W: '5서 중앙 계단' };
let insideFloor = null, insideWing = null, insideNear = null;
function openInside() {
  insideFloor = insideWing = insideNear = null;
  $('near').value = '';
  $('near-cands').innerHTML = '';
  $('near-hint').textContent = '';
  $('inside-title').textContent = t('inside_title');
  $('inside-near-label').textContent = t('inside_near');
  $('near').placeholder = t('inside_near_ph');
  $('inside-or').textContent = t('inside_or');
  $('inside-go').textContent = t('inside_start');
  renderInsidePicks();
  sheet('s-inside');
}
function renderInsidePicks() {
  $('pick-floor').innerHTML = [0, 1, 2, 3, 4, 5].map(f => `<button class="mini" data-floor="${f}" aria-pressed="${insideFloor === f}">${Indoor.floorName(f)}</button>`).join('');
  $('pick-wing').innerHTML = insideFloor === 0 ? '' : ['S', 'E', 'N', 'W'].filter(w => !(insideFloor === 1 && w === 'W'))
    .map(w => `<button class="mini" data-wing="${w}" aria-pressed="${insideWing === w}">${t('wing_' + w)}</button>`).join('');
  $('inside-go').disabled = !(insideNear || insideFloor === 0 || (insideFloor !== null && insideWing));
}
function insideStart() {
  if (insideNear) return insideNear;
  if (insideFloor === 0) return 'B1:clubs';
  return `${CENTRAL[insideWing]}|${insideFloor}`;
}
function enterIndoor(from) {
  stopGPS();
  stopSim();
  indoorFrom = from;
  const r = Indoor.route(from, target.id, { nw: $('nw').checked });
  if (!r) { banner(t('room_missing_none', { label: target.label })); return; }
  plan = { path: r.path, steps: Indoor.buildSteps(r.path) };
  phase = 'indoor';
  inStep = 0;
  me = null;
  banner('');
  $('compass').hidden = true;
  $('recenter').hidden = true;
  $('sim-badge').hidden = true;
  $('nw-label').textContent = t('nw_toggle');
  $('in-note').textContent = t('data_note');
  sheet('s-indoor');
  showIndoor();
}
function showIndoor() {
  const st = plan.steps[inStep];
  $('instr').hidden = false;
  $('i-icon').innerHTML = iconSvg(st.icon);
  $('i-dist').textContent = st.from !== undefined ? `${Indoor.floorName(st.from)} → ${Indoor.floorName(st.f)}` : Indoor.floorName(st.f);
  $('i-say').textContent = st.title;
  $('i-to').textContent = st.sub;
  $('i-eta').textContent = `${inStep + 1} / ${plan.steps.length}`;
  $('in-prev').disabled = inStep === 0;
  $('in-next').textContent = inStep === plan.steps.length - 1 ? '처음으로' : '다음';
  fitScreen(Indoor.viewBounds(plan, inStep), 24, 80);
}
$('in-prev').onclick = () => { if (inStep > 0) { inStep--; showIndoor(); } };
$('in-next').onclick = () => { if (inStep < plan.steps.length - 1) { inStep++; showIndoor(); } else reset(); };
$('nw').onchange = () => { if (phase === 'indoor') enterIndoor(indoorFrom); };
$('go-inside').onclick = openInside;
$('inside-go').onclick = () => enterIndoor(insideStart());
$('near').oninput = () => {
  readRoom('near', 'near-hint', 'near-cands', p => { insideNear = p ? p.id : null; });
  renderInsidePicks();
};
$('room').oninput = onRoomInput;
$('room').placeholder = t('room_ph');

// ---------- wiring ----------
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cand) chooseCandidate(b);
  else if (b.dataset.quick === 'tower') { $('room').value = ''; $('room-hint').textContent = ''; setTarget(null); renderQuick(); $('tower-floors').hidden = false; }
  else if (b.dataset.quick) { $('room').value = ''; $('room-hint').textContent = ''; $('room-cands').innerHTML = ''; $('tower-floors').hidden = true; setTarget({ id: b.dataset.quick, label: Indoor.label(b.dataset.quick) }); renderQuick(); }
  else if (b.dataset.tower) { setTarget({ id: 'T:' + b.dataset.tower, label: Indoor.label('T:' + b.dataset.tower) }); renderQuick(); }
  else if (b.dataset.floor) { insideFloor = +b.dataset.floor; insideWing = null; renderInsidePicks(); }
  else if (b.dataset.wing) { insideWing = b.dataset.wing; renderInsidePicks(); }
  else if (b.dataset.start) startManual(b.dataset.start);
  else if (b.hasAttribute('data-back')) reset();
});
// The browser remembers the permission; we only ask it what the state is, and store nothing ourselves.
async function askLocation() {
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* older browsers: just ask */ }
  if (state === 'granted') startGPS();
  else if (state === 'denied') onPosError({ code: 1 });
  else sheet('s-ask');
}
$('go-gps').onclick = askLocation;
$('far-manual').onclick = toManual;
$('far-retry').onclick = askLocation;
$('ask-ok').onclick = startGPS;
$('go-manual').onclick = toManual;
$('denied-manual').onclick = toManual;
$('denied-retry').onclick = () => sheet('s-ask');
$('nav-overview').onclick = () => { follow = false; $('recenter').hidden = !me; overview(); };
$('nav-stop').onclick = reset;
window.addEventListener('resize', () => { placeFabs(); draw(); });

renderQuick();
renderStarts();
reset();
