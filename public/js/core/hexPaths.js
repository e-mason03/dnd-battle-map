// ============================================================
// Hexcrawl paths: well-known roads and trails between hexes.
// A hex's `path` lists the keys of neighbors it shares a path with
// (stored on both hexes). Traveling along a path is 25% faster, so
// a step on it costs 0.8 of a normal step.
// ============================================================

import { hexKey, parseHexKey, hexNeighbors, hexDistance } from './hexmath.js';

export const PATH_SPEED = 1.25;
const ROAD_COST = 1 / PATH_SPEED;

// Neighbor keys a hex has paths to, ignoring any that aren't adjacent
// (e.g. after the grid's orientation changed)
export function pathLinks(hex, k) {
  const list = hex.hexes[k]?.path;
  if (!list?.length) return [];
  const [c, r] = parseHexKey(k);
  return list.filter(nk => hexDistance([c, r], parseHexKey(nk), hex.orientation) === 1);
}

export const onPath = (hex, a, b) => (hex.hexes[a]?.path || []).includes(b) || (hex.hexes[b]?.path || []).includes(a);

// hex.paint patches that connect consecutive hexes of `cells` ([[c, r], …])
export function linkPatches(hex, cells) {
  const next = new Map();
  const get = k => next.get(k) || [...(hex.hexes[k]?.path || [])];
  for (let i = 1; i < cells.length; i++) {
    const a = hexKey(...cells[i - 1]), b = hexKey(...cells[i]);
    if (a === b || hexDistance(cells[i - 1], cells[i], hex.orientation) !== 1) continue;
    const pa = get(a), pb = get(b);
    if (!pa.includes(b)) pa.push(b);
    if (!pb.includes(a)) pb.push(a);
    next.set(a, pa); next.set(b, pb);
  }
  return [...next].map(([k, path]) => ({ k, patch: { path } }));
}

// hex.paint patches removing every path into or out of hex `k`
export function unlinkPatches(hex, k) {
  const own = hex.hexes[k]?.path || [];
  if (!own.length) return [];
  const out = [{ k, patch: { path: null } }];
  for (const nk of own) {
    const rest = (hex.hexes[nk]?.path || []).filter(x => x !== k);
    out.push({ k: nk, patch: { path: rest.length ? rest : null } });
  }
  return out;
}

// Quickest route between two hexes (Dijkstra; path steps cost 0.8).
// Returns { route: [[c, r], …], steps, roadSteps, cost } or null.
export function travelRoute(hex, from, to) {
  const { cols, rows, orientation } = hex;
  const inGrid = ([c, r]) => c >= 0 && r >= 0 && c < cols && r < rows;
  if (!inGrid(from) || !inGrid(to)) return null;
  const goal = hexKey(...to);
  const start = hexKey(...from);
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  // Small binary heap of [cost, steps, key]; fewer steps breaks ties
  const heap = [[0, 0, start]];
  const push = item => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] < item[0] || (heap[p][0] === item[0] && heap[p][1] <= item[1])) break;
      heap[i] = heap[p]; heap[p] = item; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const less = (x, y) => heap[x][0] < heap[y][0] || (heap[x][0] === heap[y][0] && heap[x][1] < heap[y][1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  const steps = new Map([[start, 0]]);
  while (heap.length) {
    const [cost, st, k] = pop();
    if (cost > (dist.get(k) ?? Infinity) + 1e-9) continue;
    if (k === goal) break;
    for (const nb of hexNeighbors(...parseHexKey(k), orientation)) {
      if (!inGrid(nb)) continue;
      const nk = hexKey(...nb);
      const nc = cost + (onPath(hex, k, nk) ? ROAD_COST : 1);
      const old = dist.get(nk) ?? Infinity;
      if (nc < old - 1e-9 || (Math.abs(nc - old) < 1e-9 && st + 1 < steps.get(nk))) {
        dist.set(nk, nc); steps.set(nk, st + 1); prev.set(nk, k);
        push([nc, st + 1, nk]);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const route = [];
  for (let k = goal; k; k = prev.get(k)) route.unshift(parseHexKey(k));
  let roadSteps = 0;
  for (let i = 1; i < route.length; i++) if (onPath(hex, hexKey(...route[i - 1]), hexKey(...route[i]))) roadSteps++;
  return { route, steps: route.length - 1, roadSteps, cost: Math.round(dist.get(goal) * 1000) / 1000 };
}

// Rough travel days at 24 miles a day, path speed included
export const travelDays = (hex, r) => Math.round(r.cost * (hex.milesPerHex || 6) / 24 * 10) / 10;
