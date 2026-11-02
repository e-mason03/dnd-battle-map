// ============================================================
// Cover (5e DMG grid variant): the attacker picks the corner of
// its space that gives the best view and traces lines to every
// corner of the target's space.
//   0 lines blocked → no cover
//   1–2 blocked     → half cover        (+2 AC, +2 DEX saves)
//   3–4 blocked     → three-quarters    (+5 AC, +5 DEX saves)
//   all blocked by walls → total cover  (can't be targeted)
// An obstacle can never grant more than its own cover level, so a
// row of crates gives half cover no matter how many lines it blocks.
// ============================================================

import { FEATURES } from '../constants.js';

export const COVER_RANK = { none: 0, half: 1, three: 2, total: 3 };
export const COVER_BONUS = { none: 0, half: 2, three: 5, total: 0 };
export const COVER_LABEL = { half: 'half cover', three: '¾ cover', total: 'total cover' };

const byRank = ['none', 'half', 'three', 'total'];
const maxCover = (a, b) => (COVER_RANK[a] >= COVER_RANK[b] ? a : b);
const minCover = (a, b) => (COVER_RANK[a] <= COVER_RANK[b] ? a : b);

// Cover a single map cell provides to lines passing through it
export function cellCover(map, c, r) {
  const cell = map.cells[r]?.[c];
  if (!cell) return 'none';
  if (cell.elevation === 4) return 'total';
  return FEATURES[cell.feature]?.cover || 'none';
}

const INSET = 0.02; // keeps lines from grazing exactly along grid edges

function footprintCorners(t) {
  const s = t.size || 1;
  const cx = t.col + s / 2, cy = t.row + s / 2;
  const pts = [];
  for (const [x, y] of [[t.col, t.row], [t.col + s, t.row], [t.col, t.row + s], [t.col + s, t.row + s]]) {
    pts.push([x + Math.sign(cx - x) * INSET, y + Math.sign(cy - y) * INSET]);
  }
  return pts;
}

// Every grid corner of the attacker's space (a Large creature can pick any of 9)
function originCorners(t) {
  const s = t.size || 1;
  const cx = t.col + s / 2, cy = t.row + s / 2;
  const pts = [];
  for (let dy = 0; dy <= s; dy++) {
    for (let dx = 0; dx <= s; dx++) {
      const x = t.col + dx, y = t.row + dy;
      pts.push([x + Math.sign(cx - x) * INSET, y + Math.sign(cy - y) * INSET]);
    }
  }
  return pts;
}

const inside = (t, c, r) => t && c >= t.col && c < t.col + (t.size || 1) && r >= t.row && r < t.row + (t.size || 1);

// Strongest cover along one line, ignoring the attacker's and target's own squares
function traceLine(map, a, b, from, target, creatures) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(2, Math.ceil(len * 12));
  let worst = 'none';
  let lastKey = -1;
  for (let i = 1; i < steps; i++) {
    const x = a[0] + (b[0] - a[0]) * i / steps;
    const y = a[1] + (b[1] - a[1]) * i / steps;
    const c = Math.floor(x), r = Math.floor(y);
    const key = r * 10000 + c;
    if (key === lastKey) continue;
    lastKey = key;
    if (inside(from, c, r) || inside(target, c, r)) continue;
    worst = maxCover(worst, cellCover(map, c, r));
    if (creatures?.has(key)) worst = maxCover(worst, 'half');
    if (worst === 'total') break;
  }
  return worst;
}

/**
 * from:    attacker footprint {col,row,size}, or null when `point` is given
 * point:   [x, y] in cell units — origin of an area effect
 * target:  target footprint {id,col,row,size}
 * others:  other creatures' footprints (each gives half cover), may be empty
 */
export function computeCover(map, { from = null, point = null, target, others = [] }) {
  const creatures = new Map();
  for (const t of others) {
    if (t.id === target.id || (from && t.id === from.id)) continue;
    const s = t.size || 1;
    for (let dr = 0; dr < s; dr++) for (let dc = 0; dc < s; dc++) creatures.set((t.row + dr) * 10000 + t.col + dc, true);
  }
  const origins = point ? [point] : originCorners(from);
  const targets = footprintCorners(target);

  let best = 'total';
  for (const o of origins) {
    let blocked = 0, allTotal = true, cap = 'none';
    for (const tc of targets) {
      const lc = traceLine(map, o, tc, from, target, creatures);
      if (lc !== 'none') { blocked++; cap = maxCover(cap, lc); }
      if (lc !== 'total') allTotal = false;
    }
    let level = blocked === 0 ? 'none'
      : blocked === targets.length && allTotal ? 'total'
      : blocked >= 3 ? 'three' : 'half';
    level = minCover(level, cap);
    best = minCover(best, level);
    if (best === 'none') break;
  }
  return best;
}

// DM-applied cover conditions stack with the map: the better one wins
export function withManualCover(level, conditions = []) {
  if (level === 'total') return level;
  if (conditions.includes('three-quarters cover')) return maxCover(level, 'three');
  if (conditions.includes('half cover')) return maxCover(level, 'half');
  return level;
}

export { byRank as COVER_LEVELS };
