'use strict';
// Local-only arrival evidence. A nearby fix offers a button; it does not prove entry.
const EntryApproach = (() => {
  function create() {
    let destination = null, approachedAt = null, firstClose = null, lastClose = null, closeCount = 0, blockedUntil = 0;
    const clearClose = () => { firstClose = lastClose = null; closeCount = 0; };
    function reset() { destination = null; approachedAt = null; blockedUntil = 0; clearClose(); }
    function inhibit(now = Date.now()) { blockedUntil = now + 60000; approachedAt = null; clearClose(); }
    function update(p, accuracy, entrances, key, now = Date.now()) {
      const none = { near: null, auto: false };
      if (!p?.every(Number.isFinite) || !Number.isFinite(accuracy) || accuracy < 0 || !Number.isFinite(now)) { clearClose(); return none; }
      if (destination !== key) { destination = key; approachedAt = null; clearClose(); }
      const ranked = Object.entries(entrances).map(([id, q]) => ({ id, distance: Math.hypot(p[0] - q[0], p[1] - q[1]) })).sort((a, b) => a.distance - b.distance);
      const nearest = ranked[0], selected = ranked.find(item => item.id === key);
      const radius = Math.min(35, Math.max(18, accuracy + 10));
      const near = accuracy <= 60 && nearest?.distance <= radius ? nearest.id : null;
      if (!selected) { clearClose(); return { near, auto: false }; }
      if (accuracy <= 25 && selected.distance >= 25 && selected.distance <= 100) approachedAt = now;
      const unambiguous = nearest.id === key && (!ranked[1] || ranked[1].distance - nearest.distance >= Math.max(8, accuracy));
      const reliable = accuracy <= 15 && selected.distance <= 12 && unambiguous && now >= blockedUntil;
      if (!reliable) { clearClose(); return { near, auto: false }; }
      // Duplicate/cached fixes cannot advance the arrival counter.
      if (lastClose !== null && now <= lastClose) return { near, auto: false };
      if (lastClose === null || now - lastClose > 8000) { firstClose = now; closeCount = 0; }
      lastClose = now; closeCount++;
      const approached = approachedAt !== null && now - approachedAt <= 120000;
      return { near, auto: approached && closeCount >= 3 && now - firstClose >= 4000 };
    }
    return { reset, inhibit, update };
  }
  return { create };
})();
