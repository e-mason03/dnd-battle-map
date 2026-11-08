// ============================================================
// Line of sight & lighting on the battle map grid.
//
// map.vision = { mode, ambient }
//   mode 'off'   — everyone sees everything (default)
//   mode 'los'   — walls, closed doors, fog and magical darkness block
//                  sight; everything in sight is visible
//   mode 'light' — as 'los', but a cell must also be lit: ambient light
//                  ('bright' | 'dim' | 'dark'), light-emitting features,
//                  tokens carrying light, or the viewer's darkvision
//
// computeVision() returns a Uint8Array with one entry per cell:
//   0 = can't see, 1 = dim (seen, shaded), 2 = clearly seen
// ============================================================

import { FEATURES } from '../constants.js';

export const VISION_MODES = { off: 'Off', los: 'Line of sight', light: 'Dynamic lighting' };
export const AMBIENT = { bright: 'Daylight', dim: 'Dim (dusk, moonlight)', dark: 'Darkness' };

export const visionOn = map => !!map?.vision && map.vision.mode !== 'off';

// A cell you can see but not see past
function opaque(cell) {
  if (!cell) return true;
  if (cell.elevation === 4) return true;
  const f = FEATURES[cell.feature];
  return !!(f && (f.cover === 'total' || f.obscures));
}

// Walks the grid cells crossed by the segment a→b (Amanatides–Woo) and
// reports whether an opaque cell other than the end cell is in the way
function blocked(map, ax, ay, bx, by) {
  let c = Math.floor(ax), r = Math.floor(ay);
  const ec = Math.floor(bx), er = Math.floor(by);
  const dx = bx - ax, dy = by - ay;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity;
  let tx = sx ? (sx > 0 ? c + 1 - ax : ax - c) * tdx : Infinity;
  let ty = sy ? (sy > 0 ? r + 1 - ay : ay - r) * tdy : Infinity;
  // tx / ty: how far along the segment (0..1) the next column / row boundary is
  while (!(c === ec && r === er)) {
    if (Math.min(tx, ty) > 1) return false;   // segment ends before leaving this cell
    if (tx < ty) { c += sx; tx += tdx; } else { r += sy; ty += tdy; }
    if (c === ec && r === er) return false;
    if (opaque(map.cells[r]?.[c])) return true;
  }
  return false;
}

const SAMPLES = [[0.5, 0.5], [0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]];

// Can a viewer at (x, y) (cell units) see any part of cell (c, r)?
export function canSee(map, x, y, c, r) {
  if (Math.floor(x) === c && Math.floor(y) === r) return true;
  for (const [ox, oy] of SAMPLES) if (!blocked(map, x, y, c + ox, r + oy)) return true;
  return false;
}

// Light sources: features that glow, plus tokens carrying light.
// Each → { x, y, bright, dim } in cells.
export function lightSources(map, tokens) {
  const out = [];
  for (let r = 0; r < map.height; r++) {
    for (let c = 0; c < map.width; c++) {
      const f = FEATURES[map.cells[r][c].feature];
      if (f?.light) out.push({ x: c + 0.5, y: r + 0.5, bright: f.light[0] / 5, dim: f.light[1] / 5 });
    }
  }
  for (const t of tokens) {
    if (!t.light || t.conditions?.includes('dead')) continue;
    const half = (t.size || 1) / 2;
    out.push({ x: t.col + half, y: t.row + half, bright: t.light / 5, dim: (t.light * 2) / 5 });
  }
  return out;
}

const AMBIENT_LEVEL = { bright: 2, dim: 1, dark: 0 };

// viewers: [{ x, y, darkvision (ft) }]; lights: from lightSources()
export function computeVision(map, viewers, lights) {
  const W = map.width, H = map.height;
  const out = new Uint8Array(W * H);
  const mode = map.vision?.mode || 'off';
  if (mode === 'off') return out.fill(2);
  if (!viewers.length) return out;

  // How lit each cell is, before anyone's eyes are involved
  let lit = null;
  if (mode === 'light') {
    lit = new Uint8Array(W * H).fill(AMBIENT_LEVEL[map.vision.ambient] ?? 2);
    for (const L of lights) {
      const R = Math.ceil(L.dim);
      for (let r = Math.max(0, Math.floor(L.y - R)); r <= Math.min(H - 1, L.y + R); r++) {
        for (let c = Math.max(0, Math.floor(L.x - R)); c <= Math.min(W - 1, L.x + R); c++) {
          const d = Math.hypot(c + 0.5 - L.x, r + 0.5 - L.y);
          const lvl = d <= L.bright + 0.01 ? 2 : d <= L.dim + 0.01 ? 1 : 0;
          if (lvl > lit[r * W + c] && canSee(map, L.x, L.y, c, r)) lit[r * W + c] = lvl;
        }
      }
    }
    // Lit tiles are bright; magical darkness lets no light in
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const f = map.cells[r][c].feature;
        if (FEATURES[f]?.lit) lit[r * W + c] = 2;
        if (f === 'darkness') lit[r * W + c] = 0;
      }
    }
  }

  for (const v of viewers) {
    const dv = (v.darkvision || 0) / 5;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = r * W + c;
        if (out[i] === 2) continue;
        let lvl = 2;
        if (lit) {
          lvl = lit[i];
          // Darkvision: darkness → dim, dim → bright (not into magical darkness)
          if (dv && lvl < 2 && map.cells[r][c].feature !== 'darkness' && Math.hypot(c + 0.5 - v.x, r + 0.5 - v.y) <= dv + 0.01) lvl++;
          if (lvl <= out[i]) continue;
          if (!lvl) continue;
        }
        if (canSee(map, v.x, v.y, c, r)) out[i] = lvl;
      }
    }
  }
  return out;
}

// Seen level of a creature: the best of the cells it occupies
export function seenLevel(vis, map, t) {
  let best = 0;
  const sz = t.size || 1;
  for (let dr = 0; dr < sz; dr++) {
    for (let dc = 0; dc < sz; dc++) {
      const c = t.col + dc, r = t.row + dr;
      if (c >= 0 && r >= 0 && c < map.width && r < map.height) best = Math.max(best, vis[r * map.width + c]);
    }
  }
  return best;
}
