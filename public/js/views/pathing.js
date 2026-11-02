// ============================================================
// Grid movement: Dijkstra over cells with 5e costs
// (5 ft per step incl. diagonals, 10 ft into difficult terrain,
// walls block, hostile creatures block, allies can be passed)
// ============================================================

import { TERRAINS, FEATURES } from '../constants.js';

export const cellKey = (c, r) => r * 10000 + c;

function stepCost(map, c, r) {
  const cell = map.cells[r]?.[c];
  if (!cell) return Infinity;
  if (cell.elevation === 4 || FEATURES[cell.feature]?.blocks) return Infinity;
  const difficult = TERRAINS[cell.terrain]?.difficult || FEATURES[cell.feature]?.difficult;
  return difficult ? 10 : 5;
}

// blockers: Map<cellKey, 'ally'|'enemy'>; size: footprint in cells
export function reachable(map, start, maxCost, blockers, size = 1) {
  const dist = new Map();
  const prev = new Map();
  dist.set(cellKey(start[0], start[1]), 0);
  const open = [[0, start[0], start[1]]];

  // Cost of moving the whole footprint into (c, r)
  const entryCost = (c, r) => {
    let worst = 0;
    for (let dr = 0; dr < size; dr++) {
      for (let dc = 0; dc < size; dc++) {
        const k = cellKey(c + dc, r + dr);
        if (blockers.get(k) === 'enemy') return Infinity;
        worst = Math.max(worst, stepCost(map, c + dc, r + dr));
      }
    }
    return worst;
  };

  // Whether a single step from (c, r) to (nc, nr) is allowed (ignoring cost)
  const canStep = (c, r, nc, nr) => {
    if (nc < 0 || nr < 0 || nc + size > map.width || nr + size > map.height) return false;
    const dc = nc - c, dr = nr - r;
    // No squeezing diagonally between two walls
    return !(dc && dr && stepCost(map, c + dc, r) === Infinity && stepCost(map, c, r + dr) === Infinity);
  };

  while (open.length) {
    // Small grids — a sorted array is fast enough
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [d, c, r] = open.splice(bi, 1)[0];
    if (d > (dist.get(cellKey(c, r)) ?? Infinity)) continue;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc, nr = r + dr;
        if (!canStep(c, r, nc, nr)) continue;
        const cost = entryCost(nc, nr);
        if (cost === Infinity) continue;
        const nd = d + cost;
        if (nd > maxCost) continue;
        const k = cellKey(nc, nr);
        if (nd < (dist.get(k) ?? Infinity)) {
          dist.set(k, nd);
          prev.set(k, [c, r]);
          open.push([nd, nc, nr]);
        }
      }
    }
  }
  return { dist, prev, entryCost, canStep };
}

// Walks back from `end` to `start` through the reachable set. Diagonals cost
// the same as straight steps on a 5e grid, so there are usually many equally
// cheap routes; at each step this picks the predecessor closest to the
// straight line between start and end, so open-ground moves look straight.
export function buildPath(reach, start, end) {
  const { dist, entryCost, canStep } = reach;
  if (!dist.has(cellKey(end[0], end[1]))) return null;
  const [sx, sy] = start;
  const lx = end[0] - sx, ly = end[1] - sy;
  const len2 = lx * lx + ly * ly || 1;
  const offLine = (c, r) => {
    const t = Math.max(0, Math.min(1, ((c - sx) * lx + (r - sy) * ly) / len2));
    return Math.hypot(sx + t * lx - c, sy + t * ly - r);
  };

  const path = [end];
  let cur = end;
  for (let guard = 0; (cur[0] !== sx || cur[1] !== sy) && guard < 5000; guard++) {
    const here = dist.get(cellKey(cur[0], cur[1]));
    const enter = entryCost(cur[0], cur[1]);
    let best = null, bestScore = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const pc = cur[0] + dc, pr = cur[1] + dr;
        const d = dist.get(cellKey(pc, pr));
        if (d === undefined || d + enter !== here || !canStep(pc, pr, cur[0], cur[1])) continue;
        // Prefer staying on the line; on a tie, prefer a straight step
        const score = offLine(pc, pr) + (dc && dr ? 0.001 : 0);
        if (score < bestScore) { bestScore = score; best = [pc, pr]; }
      }
    }
    if (!best) return null;
    path.unshift(best);
    cur = best;
  }
  return path;
}

// Chebyshev distance in feet between two footprints (5e grid rule)
export function feetBetween(a, b) {
  const as = a.size || 1, bs = b.size || 1;
  const dx = Math.max(0, b.col - (a.col + as - 1), a.col - (b.col + bs - 1));
  const dy = Math.max(0, b.row - (a.row + as - 1), a.row - (b.row + bs - 1));
  return Math.max(dx, dy) * 5;
}
