// ============================================================
// Area-of-effect shapes on the grid. A cell is in the area when
// its center is. Coordinates are in cells (1 cell = 5 ft).
//   circle — radius around the aimed cell
//   cone   — from the caster's edge toward the aim; as wide as it
//            is far from its origin (5e), so half-width = d / 2
//   line   — from the caster's edge toward the aim, 5 ft wide
//   cube   — cast from self: sits flush against the caster's space
//            toward the aim; otherwise centered on the aimed cell
// ============================================================

// a: action { radius (ft), shape, range (ft) }
// caster: footprint { col, row, size }; aim: [c, r] cell
// Returns { shape, test(c, r) → bool, origin: [x, y], outline } where
// `origin` is where cover is measured from and `outline` describes the
// shape for drawing.
export function areaOf(a, caster, aim) {
  const shape = a.shape || 'circle';
  const L = (a.radius || 0) / 5;
  const target = [aim[0] + 0.5, aim[1] + 0.5];

  if (shape === 'circle' || !caster) {
    return {
      shape: 'circle', origin: target, outline: { kind: 'circle', x: target[0], y: target[1], r: L },
      test: (c, r) => Math.hypot(c - aim[0], r - aim[1]) <= L + 0.01,
    };
  }

  const half = (caster.size || 1) / 2;
  const o = [caster.col + half, caster.row + half];
  let dx = target[0] - o[0], dy = target[1] - o[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.01) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const own = (c, r) => c >= caster.col && c < caster.col + (caster.size || 1) && r >= caster.row && r < caster.row + (caster.size || 1);
  // Distance from the caster's edge along the aim, and distance off the axis
  const local = (c, r) => {
    const vx = c + 0.5 - o[0], vy = r + 0.5 - o[1];
    return { d: vx * dx + vy * dy - half, perp: Math.abs(vx * dy - vy * dx) };
  };

  if (shape === 'cone') {
    return {
      shape, origin: o, outline: { kind: 'cone', o, dir: [dx, dy], start: half, len: L },
      test: (c, r) => {
        if (own(c, r)) return false;
        const { d, perp } = local(c, r);
        return d > 0 && d <= L && perp <= d / 2 + 0.35;
      },
    };
  }

  if (shape === 'line') {
    return {
      shape, origin: o, outline: { kind: 'line', o, dir: [dx, dy], start: half, len: L, width: 1 },
      test: (c, r) => {
        if (own(c, r)) return false;
        const { d, perp } = local(c, r);
        return d > 0 && d <= L && perp <= 0.5;
      },
    };
  }

  // Cube: snap the center so the cube lines up with the grid
  const snap = v => (L % 2 ? Math.floor(v) + 0.5 : Math.round(v));
  let cx, cy;
  const fromSelf = (a.range || 0) <= (a.radius || 0);
  if (fromSelf) {
    // Push out along the dominant axis (diagonals push out on both)
    const ax = Math.abs(dx) > 0.38 ? Math.sign(dx) : 0, ay = Math.abs(dy) > 0.38 ? Math.sign(dy) : 0;
    cx = ax ? o[0] + ax * (half + L / 2) : snap(o[0]);
    cy = ay ? o[1] + ay * (half + L / 2) : snap(o[1]);
    cx = snap(cx); cy = snap(cy);
  } else {
    cx = snap(target[0]); cy = snap(target[1]);
  }
  return {
    shape, origin: fromSelf ? o : [cx, cy], outline: { kind: 'rect', x: cx - L / 2, y: cy - L / 2, w: L, h: L },
    test: (c, r) => !own(c, r) && Math.abs(c + 0.5 - cx) < L / 2 && Math.abs(r + 0.5 - cy) < L / 2,
  };
}

// Is the area aimed by direction only (no range check on the aim point)?
export const aimedFromSelf = a => a.shape === 'cone' || a.shape === 'line' || (a.shape === 'cube' && (a.range || 0) <= (a.radius || 0));

// Creatures (token views) whose space overlaps the area
export function creaturesInArea(area, tokens) {
  return tokens.filter(t => {
    const sz = t.size || 1;
    for (let dr = 0; dr < sz; dr++) for (let dc = 0; dc < sz; dc++) if (area.test(t.col + dc, t.row + dr)) return true;
    return false;
  });
}

// Every cell of the area within the map bounds
export function areaCells(area, map) {
  const out = [];
  for (let r = 0; r < map.height; r++) for (let c = 0; c < map.width; c++) if (area.test(c, r)) out.push([c, r]);
  return out;
}
