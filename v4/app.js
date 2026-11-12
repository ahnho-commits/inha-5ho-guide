'use strict';
// Outdoor wayfinding to 5호관. Map units are metres (x east, y south) from campus-data.js.
// Location never leaves this page: no fetch, no storage, nothing in the URL.

const C = CAMPUS;
const $ = id => document.getElementById(id);
const svg = $('map');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const project = (lat, lon) => [(lon - C.origin[1]) * C.kx, -(lat - C.origin[0]) * C.ky];

const STARTS = {
  station: { get title() { return localName('인하대역'); }, get sub() { return t('app.start.station_sub'); } },
  main: { get title() { return localName('정문'); }, sub: '' },
  back: { get title() { return localName('후문'); }, sub: '' },
  side: { get title() { return localName('쪽문'); }, get sub() { return t('app.start.side_sub'); } },
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
  const r = { pts, segKind, cum, total: cum[cum.length - 1], dest: destKey, destName: localName(dest.name),
    startRaw: startName, startName: startName ? localName(startName) : t('app.position_now'), from };
  r.steps = buildSteps(r);
  return r;
}

function pointAt(r, s) {
  if (r.pts.length < 2 || r.total === 0) return r.pts[0];
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
  const steps = [{ at: 0, dir: 'start', text: t('app.depart', { place: r.startName }) }];
  for (const turnInfo of turns) {
    const dir = turnInfo.turn > 0 ? (turnInfo.turn < 60 ? 'slight-right' : 'right') : (turnInfo.turn > -60 ? 'slight-left' : 'left');
    // The place you just left is no help as a landmark ("후문 앞에서" right after leaving 후문).
    const lm = LANDMARKS.filter(l => dist(l.p, turnInfo.p) < 60 && dist(l.p, r.from) > 40).sort((a, b) => dist(a.p, turnInfo.p) - dist(b.p, turnInfo.p))[0];
    const next = kindAt(r, turnInfo.at + 1);
    const key = 'app.turn.' + dir.replace('-', '_') + (next === 1 ? '_field' : lm ? '_at' : '');
    const text = t(key, { place: lm ? localName(lm.name) : '' });
    steps.push({ at: turnInfo.at, dir, text, p: turnInfo.p });
  }
  steps.push({ at: r.total, dir: 'arrive', text: t('app.arrival', { place: r.destName }), p: r.pts[r.pts.length - 1] });
  if (steps[1] && dist(r.from, C.pois['start:side'].p) < 30) steps[1].photo = 'gate';
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
  const sideMap = typeof RouteSheet !== 'undefined' ? RouteSheet.mapViewport() : null;
  if (sideMap) {
    const W = svg.clientWidth;
    const m = Math.max((Math.max(...xs) - Math.min(...xs) || 60) / Math.max(120, sideMap.right - sideMap.left - padPx),
      (Math.max(...ys) - Math.min(...ys) || 60) / Math.max(100, sideMap.bottom - sideMap.top - padPx), minSpan / W);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    goView({ w: Math.min(1600, m * W), x: cx - (sideMap.left + sideMap.right) / 2 * m, y: cy - (sideMap.top + sideMap.bottom) / 2 * m });
    return;
  }
  const topBar = document.querySelector('.top'), languageBar = document.querySelector('.language-bar');
  const top = Math.max(70, topBar?.getBoundingClientRect().bottom || 0, languageBar?.getBoundingClientRect().bottom || 0) + 12;
  const bottom = visibleSheetHeight() + 20;
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

function mapLabelLines(text, maxWidth, fontSize, weight) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  const segments = word => typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(LANG, { granularity: 'grapheme' }).segment(word)].map(part => part.segment) : [...word];
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (textWidth(next, fontSize, weight) <= maxWidth) { line = next; continue; }
    if (line) { lines.push(line); line = ''; }
    for (const glyph of segments(word)) {
      if (line && textWidth(line + glyph, fontSize, weight) > maxWidth) { lines.push(line); line = ''; }
      line += glyph;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
const svgText = value => String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
function mapLabelArea(k) {
  const mapTop = svg.getBoundingClientRect().top;
  const top = Math.max(document.querySelector('.top')?.getBoundingClientRect().bottom || 0,
    document.querySelector('.language-bar')?.getBoundingClientRect().bottom || 0) - mapTop + 6;
  const sheets = [...document.querySelectorAll('.sheet')].filter(el => !el.hidden)
    .map(el => el.getBoundingClientRect().top - mapTop).filter(y => y > top);
  const bottom = Math.min(svg.clientHeight, ...sheets) - 6;
  return { left: view.x + 8 * k, right: view.x + view.w - 8 * k,
    top: view.y + top * k, bottom: view.y + Math.max(top + 35, bottom) * k };
}
function labelOverlap(a, b, gap = 0) {
  return Math.max(0, Math.min(a.x + a.w + gap, b.x + b.w) - Math.max(a.x - gap, b.x))
    * Math.max(0, Math.min(a.y + a.h + gap, b.y + b.h) - Math.max(a.y - gap, b.y));
}
function mapUiObstacles(k) {
  const mapRect = svg.getBoundingClientRect();
  return ['zoom-in', 'zoom-out', 'recenter', 'compass'].map(id => $(id)).filter(el => !el.hidden)
    .map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
    .map(rect => ({ x: view.x + (rect.left - mapRect.left) * k, y: view.y + (rect.top - mapRect.top) * k,
      w: rect.width * k, h: rect.height * k, ui: true }));
}
function pill(p, z, text, fill, k, occupied = [], area = mapLabelArea(k), fullText = text, required = false) {
  const [x, y] = S(p, z), fs = 13 * k;
  const lines = mapLabelLines(text, Math.max(80, Math.min(200, svg.clientWidth - 44)), 13, 700);
  const w = (Math.max(...lines.map(line => textWidth(line, 13, 700))) + 20) * k, h = (lines.length * 17 + 9) * k;
  const marker = `<circle r="${4.5 * k}" fill="${fill}" stroke="#fff" stroke-width="${1.8 * k}"/>`;
  // A pin below the sheet must not leave a detached, half-covered label above it.
  if (y > area.bottom) return `<g transform="translate(${x} ${y})"><title>${svgText(fullText)}</title>${marker}</g>`;
  const naturalBox = { x: x - w / 2, y: y - h - 9 * k, w, h };
  const visible = (x >= area.left && x <= area.right && y >= area.top && y <= area.bottom)
    || labelOverlap(naturalBox, { x: area.left, y: area.top, w: area.right - area.left, h: area.bottom - area.top }) > 0;
  const offsets = visible ? [[0, -h - 9 * k], [0, 9 * k], [w / 2 + 12 * k, -h / 2], [-w / 2 - 12 * k, -h / 2], [0, -h - 44 * k], [0, 44 * k]] : [[0, -h - 9 * k]];
  if (visible) for (const obstacle of occupied.filter(box => box.ui)) {
    offsets.push([obstacle.x - w / 2 - 6 * k - x, -h - 9 * k],
      [obstacle.x + obstacle.w + w / 2 + 6 * k - x, -h - 9 * k],
      [0, obstacle.y - h - 6 * k - y], [0, obstacle.y + obstacle.h + 6 * k - y]);
  }
  const choices = offsets.map(([dx, dy], i) => {
    const box = { x: x + dx - w / 2, y: y + dy, w, h };
    if (visible || (x >= view.x && x <= view.x + view.w)) box.x = Math.max(area.left, Math.min(area.right - w, box.x));
    if (visible) {
      box.y = Math.max(area.top, Math.min(area.bottom - h, box.y));
    }
    const overlap = occupied.reduce((sum, other) => sum + labelOverlap(box, other, 4 * k), 0);
    return { box, overlap, score: overlap + i * k * k };
  });
  const free = choices.find(item => item.overlap === 0);
  if (visible && !free && !required) return `<g transform="translate(${x} ${y})"><title>${svgText(fullText)}</title>${marker}</g>`;
  const box = (free || choices.reduce((best, item) => item.score < best.score ? item : best)).box;
  if (visible) occupied.push(box);
  const dx = box.x + w / 2 - x, dy = box.y - y, textY = dy + 17 * k;
  const connector = visible && (Math.abs(dx) > k || Math.abs(dy + h + 9 * k) > k)
    ? `<path d="M0 0L${dx} ${dy + h / 2}" fill="none" stroke="${fill}" stroke-width="${1.5 * k}"/>` : '';
  return `<g transform="translate(${x} ${y})"><title>${svgText(fullText)}</title>${connector}<rect x="${dx - w / 2}" y="${dy}" width="${w}" height="${h}" rx="${Math.min(13 * k, h / 2)}" fill="${fill}"/><text font-size="${fs}" font-weight="700" fill="#fff" text-anchor="middle">${lines.map((line, i) => `<tspan x="${dx}" y="${textY + i * 17 * k}">${svgText(line)}</tspan>`).join('')}</text>${marker}</g>`;
}
const LIFT = .4;   // draw the route a hair above the ground

function draw() {
  const k = mPerPx(), h = view.w * aspect();
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${h}`);
  if (phase === 'indoor') {
    if (baseShown !== 'indoor') { $('base').innerHTML = ''; baseShown = 'indoor'; }
    const sideMap = typeof RouteSheet !== 'undefined' ? RouteSheet.mapViewport() : null;
    const labelBounds = { left: view.x + (sideMap?.left ?? 12) * k, right: view.x + (sideMap?.right ?? svg.clientWidth - 68) * k };
    $('over').innerHTML = `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${h}" fill="var(--ground)"/>` + Indoor.drawIso(k, plan, inStep, labelBounds);
    return;
  }
  if (baseShown !== 'outdoor') { $('base').innerHTML = BASE3D; baseShown = 'outdoor'; xrayFor = undefined; }
  applyXray();
  let s = '';
  const labelBoxes = mapUiObstacles(k), labelArea = mapLabelArea(k);
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
  // Reserve the destination first; secondary labels can disappear at dense zoom levels.
  const destKey = route ? route.dest : selectedDest, d = C.pois['dest:' + destKey];
  const wingCode = { corner: '5E·5N', east: '5E', south: '5S' }[destKey];
  const destinationLabel = wingCode ? `${wingCode} · ${t('nav.entry')}` : localName(d.name);
  s += pill(d.p, 0, destinationLabel, 'var(--dest)', k, labelBoxes, labelArea, localName(d.name), true);
  const starts = Object.entries(C.pois).filter(([key]) => key.startsWith('start:'));
  starts.sort(([a], [b]) => Number(b === 'start:' + route?.manualStartKey) - Number(a === 'start:' + route?.manualStartKey));
  for (const [key, v] of starts) {
    s += pill(v.p, 0, localName(key === 'start:station' ? '인하대역' : v.name), 'var(--ink)', k, labelBoxes, labelArea);
  }
  for (const l of LANDMARKS.filter(l => C.buildings.some(b => b.name === l.name && (b.main || l.name !== '5호관')))) {
    const b = C.buildings.find(b => b.name === l.name && (b.main || l.name !== '5호관'));
    const [x, y] = S(l.p, Math.min(MAX_H, (b.lv || 3) * 3.4));
    const big = b.main;
    const fontSize = big ? 16 : 12, weight = big ? 800 : 600;
    const lines = mapLabelLines(localName(l.name), Math.min(180, svg.clientWidth - 40), fontSize, weight);
    const width = Math.max(...lines.map(line => textWidth(line, fontSize, weight))) * k;
    const box = { x: x - width / 2, y: y - (lines.length - 1) / 2 * (fontSize + 3) * k - fontSize * k,
      w: width, h: lines.length * (fontSize + 3) * k };
    if (box.y < labelArea.top || box.y + box.h > labelArea.bottom || labelBoxes.some(other => labelOverlap(box, other, 4 * k) > 0)) continue;
    labelBoxes.push(box);
    s += `<text class="lbl" font-size="${fontSize * k}" font-weight="${weight}" fill="${big ? 'var(--dest)' : 'var(--muted)'}" stroke-width="${3.5 * k}" text-anchor="middle">${lines.map((line, i) => `<tspan x="${x}" y="${y + (i - (lines.length - 1) / 2) * (fontSize + 3) * k}">${svgText(line)}</tspan>`).join('')}</text>`;
  }
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
const SHEETS = ['s-entry', 's-start', 's-ask', 's-denied', 's-manual', 's-route', 's-nav', 's-far', 's-inside', 's-indoor'];
function sheet(id) {
  for (const s of SHEETS) $(s).hidden = s !== id;
  if (typeof RouteSheet !== 'undefined') RouteSheet.sync();
  placeFabs();
}
function placeFabs() {
  const sideMap = typeof RouteSheet !== 'undefined' ? RouteSheet.mapViewport() : null;
  $('fabs').style.bottom = (sideMap ? 32 : visibleSheetHeight() + 12) + 'px';
}
$('fabs').addEventListener('transitionend', event => {
  if (event.propertyName === 'bottom' && phase !== 'indoor') draw();
});
let bannerMessage = null;
const displayMessage = message => typeof message === 'function' ? message() : message || '';
function banner(text, btn, onBtn) {
  bannerMessage = { text, btn, onBtn };
  renderBanner();
}
function renderBanner() {
  if (!bannerMessage) return;
  const { text, btn, onBtn } = bannerMessage;
  $('banner').hidden = !text;
  $('banner-text').textContent = displayMessage(text);
  $('banner-btn').hidden = !btn;
  $('banner-btn').textContent = displayMessage(btn);
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
// Real photos for the steps where one helps. Small in the card, full screen on tap.
const PHOTOS = Object.defineProperties({}, Object.fromEntries(['gate', 'door', 'lobby', 'bnorth', 'bsouth', 'towersign']
  .map(key => [key, { enumerable: true, get: () => t('app.photo.' + key) }])));
function setPhoto(key) {
  const b = $('i-photo');
  b.hidden = !key;
  $('instr').classList.toggle('photo', !!key);
  if (!key) return;
  b.firstElementChild.src = `../img/${key}.jpg`;
  b.firstElementChild.alt = PHOTOS[key];
  b.dataset.photo = key;
}
$('i-photo').onclick = () => {
  const v = $('viewer'), key = $('i-photo').dataset.photo;
  v.firstElementChild.src = `../img/${key}.jpg`;
  v.firstElementChild.alt = PHOTOS[key];
  v.lastElementChild.textContent = t('app.real_photo', { caption: PHOTOS[key] });
  v.hidden = false;
};
$('viewer').onclick = () => { $('viewer').hidden = true; };
function showInstr(step, distM) {
  $('i-checkpoints').hidden = true;
  $('instr').hidden = false;
  setPhoto(step.photo);
  $('i-icon').innerHTML = iconSvg(step.dir);
  $('i-dist').textContent = step.dir === 'arrive' && distM < ARRIVE_M ? t('app.arrived') : `${Math.max(0, Math.round(distM / 5) * 5)}m`;
  $('i-say').textContent = step.text + (step.guess ? t('app.checking_route') : '');
  const remain = route.total - progress;
  $('i-to').textContent = t('app.distance_to', { place: route.destName, distance: Math.round(remain) });
  $('i-eta').textContent = t('app.walk_minutes', { minutes: Math.max(1, Math.ceil(remain / WALK / 60)) });
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
  $('quick').innerHTML = [['B1:clubs', t('quick_b1')], ['B1S:clubs', t('quick_b1_south')], ['tower', t('quick_tower') + ' ' + t('quick_tower_sub')]]
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
  entryReturn = null; nearEntrance = null; entryApproach.reset();
  $('entry-resume').hidden = true; $('entry-near').hidden = true;
  phase = 'outdoor';
  plan = null;
  stopGPS();
  stopCompass();
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
let watchId = null, watchGeneration = 0, offCount = 0, gotFix = false;
let farMessage = null, deniedMessage = null;
const outdoorGPSActive = () => mode === 'gps' && phase === 'outdoor';
function watchGPS() {
  if (!outdoorGPSActive() || document.hidden || watchId !== null) return;
  const generation = ++watchGeneration;
  const current = () => generation === watchGeneration && outdoorGPSActive() && !document.hidden;
  watchId = navigator.geolocation.watchPosition(
    pos => { if (current()) onPos(pos); },
    error => { if (current()) onPosError(error); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}
function startGPS() {
  if (phase !== 'outdoor') return;
  entryApproach.reset(); entryReturn = null; nearEntrance = null; renderEntryAssist();
  stopGPS();
  stopCompass();
  stopSim();
  if (!('geolocation' in navigator)) return denied('app.gps.unsupported', []);
  mode = 'gps';
  gotFix = false;
  offCount = 0;
  sheet('s-nav');
  banner(() => t('app.gps.searching'));
  $('compass').hidden = false;
  watchGPS();
}
function stopGPS() {
  // clearWatch cannot recall callbacks already queued by the browser.
  watchGeneration++;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopGPS();
  else watchGPS();
  syncCompass();
});
function onPos(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const p = project(latitude, longitude);
  gotFix = true;
  if (!inArea(p, 150)) return outsideArea(latitude, longitude);
  handleFix(p, accuracy, pos.timestamp || Date.now());
}
// Great-circle distance, so someone opening this abroad still gets a sensible number.
function kmToCampus(lat, lon) {
  const d = C.pois['dest:south'].p;
  const lat2 = C.origin[0] - d[1] / C.ky, lon2 = C.origin[1] + d[0] / C.kx;
  const r = Math.PI / 180, a = Math.sin((lat2 - lat) * r / 2) ** 2 + Math.cos(lat * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon) * r / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
function outsideArea(lat, lon) {
  nearEntrance = null; renderEntryAssist();
  const km = kmToCampus(lat, lon);
  const far = km < 1 ? `${Math.round(km * 100) * 10}m` : `${km.toFixed(1)}km`;
  route = null;
  me = null;
  $('instr').hidden = true;
  if (km <= NEAR_KM) {
    banner(() => t('app.gps.near', { distance: far }), () => t('app.manual_start'), toManual);
    fit(Object.values(C.pois).map(v => v.p));
    return;
  }
  stopGPS();
  stopCompass();
  mode = null;
  banner('');
  $('compass').hidden = true;
  farMessage = () => km < 100 ? t('app.gps.far', { distance: far }) : t('app.gps.very_far');
  $('far-dist').textContent = farMessage();
  sheet('s-far');
  fit(Object.values(C.pois).map(v => v.p));
}
function onPosError(err) {
  nearEntrance = null; renderEntryAssist();
  if (err.code === 1) {
    stopGPS();
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    denied('app.gps.denied', ios
      ? ['app.gps.ios_site', 'app.gps.ios_system', 'app.gps.reload']
      : ['app.gps.android_site', 'app.gps.system_on', 'app.gps.reload']);
  } else if (!gotFix) {
    stopGPS();
    denied('app.gps.not_found', ['app.gps.try_outside', 'app.gps.manual_alternative']);
  }
}
function denied(why, steps) {
  stopGPS();
  stopCompass();
  mode = null;
  deniedMessage = { why, steps };
  renderDenied();
  banner('');
  sheet('s-denied');
}
function renderDenied() {
  if (!deniedMessage) return;
  $('denied-why').textContent = t(deniedMessage.why);
  $('denied-steps').replaceChildren(...deniedMessage.steps.map(key => {
    const li = document.createElement('li'); li.textContent = t(key); return li;
  }));
}

function inArea(p, margin) {
  const [x0, y0, x1, y1] = C.area;
  return p[0] > x0 - margin && p[0] < x1 + margin && p[1] > y0 - margin && p[1] < y1 + margin;
}

function handleFix(p, acc, timestamp = Date.now()) {
  gotFix = true;
  me = { p, acc };
  if (mode === 'gps') {
    if (acc > 300) banner(() => t('app.gps.very_inaccurate', { accuracy: Math.round(acc) }), () => t('app.manual_start'), toManual);
    else if (acc > 50) banner(() => t('app.gps.inaccurate', { accuracy: Math.round(acc) }));
    else banner('');
  }
  if (!route) {
    selectedDest = pickEntrance(p);
    route = buildRoute(p, selectedDest, '');
    progress = 0;
    follow = true;
    overview();
    setTimeout(() => { if (follow && me) centerOnMe(); }, 1200);
  }
  if (mode === 'gps') {
    const evidence = entryApproach.update(p, acc, ENTRY_POINTS, route.dest, timestamp);
    nearEntrance = evidence.near;
    renderEntryAssist();
    if (evidence.auto) return arrive();
  }
  updateProgress(p, acc);
}

function updateProgress(p, acc) {
  if (route.pts.length < 2 || route.total === 0) {
    if (mode === 'sim') return arrive();
    progress = 0;
    const st = nextStepFrom(0); showInstr(st, 0);
    if (follow) centerOnMe(); else draw();
    return;
  }
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
      route = buildRoute(p, selectedDest, '');
      progress = 0;
      banner(() => t('app.gps.rerouted'));
      setTimeout(() => banner(''), 3000);
      return updateProgress(p, acc);
    }
  } else offCount = 0;
  progress = Math.max(progress, best.s);
  const remain = route.total - progress;
  if (mode === 'sim' && remain < ARRIVE_M) return arrive();
  const st = nextStepFrom(progress);
  showInstr(st, st.at - progress);
  if (follow) centerOnMe(); else draw();
}

function arrive() {
  const wasGPS = mode === 'gps';
  if (wasGPS) rememberEntryReturn();
  stopGPS();
  stopSim();
  progress = route.total;
  enterIndoor('ENT:' + route.dest);
  if (wasGPS) {
    banner(() => t('entry.auto'), () => t('entry.cancel'), resumeOutdoor);
    const notice = bannerMessage;
    setTimeout(() => { if (bannerMessage === notice) banner(''); }, 8000);
  }
  else {
    banner(() => t('arrived_banner', { entrance: localName(C.pois['dest:' + route.dest].name) }));
    setTimeout(() => banner(''), 4000);
  }
}

// Entry selection stays local and keeps the destination, route and language.
const ENTRY_POINTS = Object.fromEntries(['south', 'corner', 'east'].map(key => [key, C.pois['dest:' + key].p]));
const entryApproach = EntryApproach.create();
let nearEntrance = null, entryReturn = null, entryOptionsLanguage = null;
function renderEntryAssist() {
  $('entry-near').hidden = !nearEntrance;
  $('entry-near-confirm').textContent = nearEntrance ? t('entry.confirm', { entrance: localName(C.pois['dest:' + nearEntrance].name) }) : '';
  // GPS fixes update proximity, but entry labels only change with the language.
  if (entryOptionsLanguage !== LANG) {
    $('entry-options').replaceChildren(...['south', 'corner', 'east'].map(key => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'entry-option';
      const name = document.createElement('strong'), note = document.createElement('small'), arrow = document.createElement('span');
      name.textContent = localName(C.pois['dest:' + key].name);
      note.textContent = t('entry.' + key + '_note');
      arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true');
      button.append(name, note, arrow);
      button.onclick = () => confirmEntry(key);
      return button;
    }));
    entryOptionsLanguage = LANG;
  }
  $('entry-resume').hidden = !entryReturn;
}
function rememberEntryReturn() {
  if (!entryReturn) entryReturn = { mode, route, me, progress, selectedDest, compassEnabled };
}
function chooseEntry() {
  if (!target || phase !== 'outdoor') return;
  rememberEntryReturn();
  stopGPS(); stopSim(); mode = 'entry'; syncCompass();
  $('instr').hidden = true; $('compass').hidden = true; $('recenter').hidden = true;
  banner(''); renderEntryAssist(); sheet('s-entry');
}
function confirmEntry(key) {
  if (!target || !Object.hasOwn(ENTRY_POINTS, key)) return;
  rememberEntryReturn();
  enterIndoor('ENT:' + key);
  renderEntryAssist();
}
function resumeOutdoor() {
  if (!entryReturn) return;
  const saved = entryReturn;
  stopGPS(); stopCompass(); stopSim();
  phase = 'outdoor'; plan = null; inStep = 0; indoorFrom = null;
  route = saved.route; me = saved.me; progress = saved.progress; selectedDest = saved.selectedDest;
  mode = saved.mode; entryReturn = null; nearEntrance = null; entryApproach.inhibit();
  $('entry-resume').hidden = true; $('entry-near').hidden = true;
  $('route-more-overlay').hidden = true; $('route-more-toggle').setAttribute('aria-expanded', 'false');
  banner('');
  if (mode === 'gps') {
    sheet('s-nav');
    compassEnabled = saved.compassEnabled; $('compass').hidden = compassEnabled;
    watchGPS(); syncCompass();
    if (route) { const st = nextStepFrom(progress); showInstr(st, st.at - progress); }
    else { $('instr').hidden = true; banner(() => t('app.gps.searching')); }
  } else { mode = null; sheet('s-start'); $('instr').hidden = true; }
  overview();
}
$('nav-inside').onclick = chooseEntry;
$('denied-inside').onclick = chooseEntry;
$('entry-near-confirm').onclick = () => { if (nearEntrance) confirmEntry(nearEntrance); };
$('entry-cancel').onclick = resumeOutdoor;
$('entry-resume').onclick = resumeOutdoor;
$('entry-other').onclick = openInside;

// ---------- compass ----------
const compassEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
let compassEnabled = false, compassListening = false, compassFrame = 0;
let compassRequest = 0, compassPending = false, compassDrawAt = -Infinity;
function drawCompass(now) {
  compassFrame = 0;
  if (!compassEnabled || !outdoorGPSActive() || document.hidden) return;
  // Sensor events can arrive much faster than the whole map needs to redraw.
  if (now - compassDrawAt < 100) { compassFrame = requestAnimationFrame(drawCompass); return; }
  compassDrawAt = now;
  draw();
}
function onCompassTurn(event) {
  if (!compassEnabled || !outdoorGPSActive() || document.hidden) return;
  const h = event.webkitCompassHeading ?? (event.absolute && event.alpha !== null ? 360 - event.alpha : null);
  if (!Number.isFinite(h)) return;
  heading = (h % 360 + 360) % 360;
  if (!compassFrame) compassFrame = requestAnimationFrame(drawCompass);
}
function syncCompass() {
  const listen = compassEnabled && outdoorGPSActive() && !document.hidden;
  if (listen && !compassListening) window.addEventListener(compassEvent, onCompassTurn);
  else if (!listen && compassListening) window.removeEventListener(compassEvent, onCompassTurn);
  compassListening = listen;
  if (!listen) {
    cancelAnimationFrame(compassFrame);
    compassFrame = 0;
    compassDrawAt = -Infinity;
  }
}
function stopCompass() {
  compassRequest++;
  compassPending = false;
  compassEnabled = false;
  heading = null;
  syncCompass();
  $('compass').hidden = true;
}
async function enableCompass() {
  if (!outdoorGPSActive() || compassEnabled || compassPending) return;
  const request = ++compassRequest;
  compassPending = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (request !== compassRequest || !outdoorGPSActive()) return;
      if (permission !== 'granted') return banner(() => t('app.compass.denied'));
    }
    if (request !== compassRequest || !outdoorGPSActive()) return;
    compassEnabled = true;
    syncCompass();
    $('compass').hidden = true;
  } catch {
    if (request === compassRequest && outdoorGPSActive()) banner(() => t('app.compass.unavailable'));
  } finally {
    if (request === compassRequest) compassPending = false;
  }
}
$('compass').onclick = enableCompass;

// ---------- manual start + simulation ----------
let stepIdx = 0, simTimer = null;
function toManual() {
  stopGPS();
  stopCompass();
  stopSim();
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
  route.manualStartKey = key;
  progress = 0;
  stepIdx = 0;
  focusStep = null;
  renderRouteSummary();
  sheet('s-route');
  showManualStep();
}
function renderRouteSummary() {
  if (!route) return;
  $('route-title').textContent = `${route.manualStartKey ? STARTS[route.manualStartKey].title : route.startName} → ${route.destName}`;
  $('route-sub').textContent = t('app.route_summary', { distance: Math.round(route.total / 10) * 10,
    minutes: Math.max(1, Math.ceil(route.total / WALK / 60)), steps: route.steps.length - 1 });
}
function showManualStep() {
  const st = route.steps[Math.min(stepIdx + 1, route.steps.length - 1)];
  const from = route.steps[stepIdx];
  progress = from.at;
  focusStep = st;
  showInstr(st, st.at - from.at);
  $('prev-step').disabled = stepIdx === 0;
  $('next-step').textContent = stepIdx >= route.steps.length - 2 ? t('indoor_go') : t('app.next_instruction');
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
  stopGPS();
  stopCompass();
  stopSim();
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
  stopGPS();
  stopCompass();
  stopSim();
  mode = null;
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
  $('pick-wing').innerHTML = (insideFloor === 0 ? ['E', 'S'] : ['S', 'E', 'N', 'W'].filter(w => !(insideFloor === 1 && w === 'W')))
    .map(w => `<button class="mini" data-wing="${w}" aria-pressed="${insideWing === w}">${t('wing_' + w)}</button>`).join('');
  $('inside-go').disabled = !(insideNear || insideFloor === 0 || (insideFloor !== null && insideWing));
}
function insideStart() {
  if (insideNear) return insideNear;
  if (insideFloor === 0) return insideWing === 'S' ? 'B1S:clubs' : 'B1:clubs';
  return `${CENTRAL[insideWing]}|${insideFloor}`;
}
function enterIndoor(from) {
  stopGPS();
  stopCompass();
  stopSim();
  mode = null;
  indoorFrom = from;
  const r = Indoor.route(from, target.id, { nw: $('nw').checked });
  if (!r) { banner(() => t('room_missing_none', { label: target.label })); return; }
  plan = { path: r.path, steps: Indoor.buildSteps(r.path) };
  phase = 'indoor';
  inStep = 0;
  me = null;
  banner('');
  $('compass').hidden = true;
  $('recenter').hidden = true;
  $('sim-badge').hidden = true;
  $('entry-resume').hidden = !entryReturn;
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
  const checkpoints = (st.checks || []).map(id => Indoor.node(id)).filter(n => n?.kind === 'room');
  const door = n => n.id.slice(2).replace(' (화장실)', '');
  $('i-checkpoints').hidden = checkpoints.length < 2;
  $('i-checkpoints-route').textContent = checkpoints.length > 1 ? t('step_checks', { list: checkpoints.map(door).join(' → ') }) : '';
  const passBasementStairs = target.id === 'B1S:clubs' && st.f === 1 && st.from === undefined
    && st.ids.includes('5E101') && st.ids.includes('5S151');
  $('i-checkpoints-wrong').hidden = !st.wrong && !passBasementStairs;
  $('i-checkpoints-wrong').textContent = passBasementStairs ? t('nav.south_basement_pass_corner')
    : st.wrong ? t('step_wrong', { room: door(Indoor.node(st.wrong)) }) : '';
  setPhoto(st.photo);
  RoutePhotos.render(st, inStep, plan.steps);
  $('i-to').textContent = st.sub;
  $('i-eta').textContent = `${inStep + 1} / ${plan.steps.length}`;
  $('in-prev').disabled = inStep === 0;
  $('in-next').textContent = inStep === plan.steps.length - 1 ? t('app.home') : t('app.next');
  if (typeof RouteSheet !== 'undefined') RouteSheet.onStep(st, inStep);
  placeFabs();
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
  else if (b.dataset.floor) { insideFloor = +b.dataset.floor; insideWing = insideFloor === 0 ? 'E' : null; renderInsidePicks(); }
  else if (b.dataset.wing) { insideWing = b.dataset.wing; renderInsidePicks(); }
  else if (b.dataset.start) startManual(b.dataset.start);
  else if (b.hasAttribute('data-back')) reset();
});
// The browser remembers the permission; we only ask it what the state is, and store nothing ourselves.
async function askLocation() {
  const generation = watchGeneration;
  let state = 'prompt';
  try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { /* older browsers: just ask */ }
  if (generation !== watchGeneration || phase !== 'outdoor') return;
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

// Change only presentation. No route search, location permission request,
// GPS watch replacement, simulation restart, or navigation reset belongs here.
function refreshAppLanguage() {
  const refreshSearch = (input, hint, candidates, selected) => {
    readRoom(input, hint, candidates, () => {});
    const parsed = Indoor.parseRoom($(input).value.trim());
    const chosen = parsed?.candidates?.find(item => item.id === selected);
    if (chosen) {
      $(hint).className = 'hint ok';
      $(hint).textContent = chosen.decode;
      for (const button of $(candidates).children) button.setAttribute('aria-pressed', String(button.dataset.cand === selected));
    }
    return parsed?.id === selected ? parsed : chosen;
  };
  const selected = refreshSearch('room', 'room-hint', 'room-cands', target?.id);
  if (target) target.label = selected?.label || Indoor.label(target.id);
  refreshSearch('near', 'near-hint', 'near-cands', insideNear);
  $('room').placeholder = t('room_ph');
  $('inside-title').textContent = t('inside_title');
  $('inside-near-label').textContent = t('inside_near');
  $('near').placeholder = t('inside_near_ph');
  $('inside-or').textContent = t('inside_or');
  $('inside-go').textContent = t('inside_start');
  $('nw-label').textContent = t('nw_toggle');
  $('in-note').textContent = t('data_note');
  renderQuick();
  renderStarts();
  renderInsidePicks();
  renderEntryAssist();
  renderDenied();
  if (farMessage) $('far-dist').textContent = farMessage();
  renderBanner();

  if (route) {
    const focusedIndex = route.steps.indexOf(focusStep);
    route.destName = localName(C.pois['dest:' + route.dest].name);
    route.startName = route.startRaw ? localName(route.startRaw) : t('app.position_now');
    route.steps = buildSteps(route);
    if (focusedIndex >= 0) focusStep = route.steps[focusedIndex];
    renderRouteSummary();
  }
  if (phase === 'indoor' && plan) {
    plan.steps = Indoor.buildSteps(plan.path);
    showIndoor();
  } else if (route && !$('s-route').hidden) {
    const savedProgress = progress;
    showManualStep();
    progress = savedProgress;
  } else if (route && !$('instr').hidden) {
    const st = nextStepFrom(progress);
    showInstr(st, st.at - progress);
  }
  placeFabs();
  draw();
}

renderQuick();
renderStarts();
reset();
