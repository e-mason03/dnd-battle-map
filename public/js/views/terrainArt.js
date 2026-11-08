// ============================================================
// Battle map ground art, drawn in layers:
//   1. textured terrain, with soft blends where terrains meet
//   2. shorelines (water foam, lava glow) and raised-ground shading
//   3. floor features (ravines, pools, webs, rubble, traps…)
//   4. wall shadows + bevelled wall tops
//   5. doors and obstacles with drop shadows
//   6. atmosphere (fire, light, darkness, fog)
// Light comes from the top-left, so shadows fall down and right.
// ============================================================

import { getPattern, getMacroPattern, CELL_PX } from './textures.js';

const LIQUID = new Set(['water', 'lava']);
// Natural ground feathers into its neighbors; built floors keep crisp edges
const BLENDS = new Set(['grass', 'dirt', 'sand', 'snow']);
const DIRS = [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']];

// Deterministic per-cell randomness so details don't flicker between frames
function hash(c, r, i = 0) {
  const n = Math.sin(c * 127.1 + r * 311.7 + i * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

// The static ground (layers 1–5) only changes when the map or camera does,
// so the live view caches it in an offscreen canvas keyed by `cacheKey`;
// only the moving bits (foam, ripples, flames, fog…) are drawn every frame.
let groundCache = null;

// Returns true when something on screen is animated (fire, water, fog…)
export function drawTerrain(ctx, map, cam, range, { cacheKey = null, W = 0, H = 0, now = performance.now() } = {}) {
  if (!cacheKey) drawGround(ctx, map, cam, range);
  else {
    const t = ctx.getTransform();
    const cw = Math.ceil(W * t.a), ch = Math.ceil(H * t.d);
    if (!groundCache || groundCache.key !== cacheKey || groundCache.canvas.width !== cw || groundCache.canvas.height !== ch) {
      groundCache ||= { canvas: document.createElement('canvas') };
      groundCache.canvas.width = cw;
      groundCache.canvas.height = ch;
      const g = groundCache.canvas.getContext('2d');
      g.setTransform(t);
      drawGround(g, map, cam, range);
      groundCache.key = cacheKey;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(groundCache.canvas, 0, 0);
    ctx.restore();
  }
  return drawAnimated(ctx, map, cam, range, now);
}

function drawGround(ctx, map, cam, range) {
  const { sc, ec, sr, er } = range;
  const s = cam.s;
  const cellAt = (c, r) => map.cells[r]?.[c];

  // ---------- Patterns anchored to the map so texture flows across cells ----------
  const k = s / CELL_PX;
  const patterns = new Map();
  const pattern = name => {
    if (!patterns.has(name)) {
      const p = getPattern(ctx, name);
      if (p) p.setTransform(new DOMMatrix([k, 0, 0, k, cam.x, cam.y]));
      patterns.set(name, p);
    }
    return patterns.get(name);
  };

  // ---------- 1. Terrain ----------
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const t = cellAt(c, r).terrain;
      if (t === 'none') continue;
      const p = pattern(t);
      if (!p) continue;
      const px = c * s + cam.x, py = r * s + cam.y;
      ctx.fillStyle = p;
      ctx.fillRect(px, py, s + 0.6, s + 0.6);
    }
  }

  // Soft blends: a neighbor's texture feathers into this cell in many faint
  // layers, with a wavy reach, so the boundary reads as an organic edge
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const t = cellAt(c, r).terrain;
      const px = c * s + cam.x, py = r * s + cam.y;
      if (t === 'stone' || t === 'wood') {
        // Built floors end in a clean, slightly raised edge
        for (const [dc, dr] of DIRS) {
          const nb = cellAt(c + dc, r + dr);
          if (!nb || nb.terrain === t || nb.terrain === 'none' || nb.elevation === 4) continue;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          const w = Math.max(1.5, s * 0.03);
          if (dc === 1) ctx.fillRect(px + s - w, py, w, s);
          else if (dc === -1) ctx.fillRect(px, py, w, s);
          else if (dr === 1) ctx.fillRect(px, py + s - w, s, w);
          else ctx.fillRect(px, py, s, w);
        }
        continue;
      }
      if (!BLENDS.has(t)) continue;
      for (const [dc, dr] of DIRS) {
        const nb = cellAt(c + dc, r + dr);
        if (!nb || nb.terrain === t || !BLENDS.has(nb.terrain)) continue;
        // Taper only where this boundary stops (a corner), not between squares
        const [ac, ar] = dr ? [1, 0] : [0, 1];
        const continues = k => cellAt(c + ac * k, r + ar * k)?.terrain === t && cellAt(c + ac * k + dc, r + ar * k + dr)?.terrain === nb.terrain;
        featherEdge(ctx, pattern(nb.terrain), px, py, s, dc, dr, c, r, !continues(-1), !continues(1));
      }
    }
  }
  ctx.globalAlpha = 1;

  // Large, soft light/dark variation that ignores the grid, hiding the
  // texture's repeat and making the ground feel uneven
  const macro = getMacroPattern(ctx);
  if (macro) {
    const mk = k * 4;  // texture spans 16 squares instead of 4
    macro.setTransform(new DOMMatrix([mk, 0, 0, mk, cam.x, cam.y]));
    ctx.fillStyle = macro;
    for (let r = sr; r < er; r++) {
      let run = -1;
      for (let c = sc; c <= ec; c++) {
        const ground = c < ec && cellAt(c, r).terrain !== 'none' && !LIQUID.has(cellAt(c, r).terrain);
        if (ground && run < 0) run = c;
        if (!ground && run >= 0) {
          ctx.fillRect(run * s + cam.x, r * s + cam.y, (c - run) * s + 0.6, s + 0.6);
          run = -1;
        }
      }
    }
  }

  // ---------- 2. Shorelines and lava glow ----------
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const cell = cellAt(c, r);
      if (!LIQUID.has(cell.terrain)) continue;
      const px = c * s + cam.x, py = r * s + cam.y;
      for (const [dc, dr] of DIRS) {
        const nb = cellAt(c + dc, r + dr);
        if (!nb || nb.terrain === cell.terrain || nb.terrain === 'none') continue;
        if (cell.terrain === 'water') drawShore(ctx, px, py, s, dc, dr);
        else drawLavaEdge(ctx, px, py, s, dc, dr);
      }
    }
  }

  // Raised ground: lighter tops, lit and shaded edges, shadows on lower ground
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const e = cellAt(c, r).elevation;
      if (!e || e >= 4) continue;
      const px = c * s + cam.x, py = r * s + cam.y;
      ctx.fillStyle = `rgba(255,245,225,${0.035 * e})`;
      ctx.fillRect(px, py, s, s);
      for (const [dc, dr] of DIRS) {
        const nb = cellAt(c + dc, r + dr);
        const ne = nb ? (nb.elevation >= 4 ? 99 : nb.elevation) : 0;
        if (ne >= e) continue;
        const lit = dc === -1 || dr === -1;
        ctx.fillStyle = lit ? 'rgba(255,250,235,0.22)' : 'rgba(0,0,0,0.45)';
        const w = Math.max(1.5, s * 0.045);
        if (dc === 1) ctx.fillRect(px + s - w, py, w, s);
        else if (dc === -1) ctx.fillRect(px, py, w, s);
        else if (dr === 1) ctx.fillRect(px, py + s - w, s, w);
        else ctx.fillRect(px, py, s, w);
        if (!lit && nb) shadowBand(ctx, px + dc * s, py + dr * s, s, -dc, -dr, s * 0.14 * (e - ne), 0.35);
      }
      // Height label at the top-left corner of each raised area
      const up = cellAt(c, r - 1), left = cellAt(c - 1, r);
      if (s >= 34 && up?.elevation !== e && left?.elevation !== e) {
        ctx.font = `600 ${Math.max(9, s * 0.2)}px "Fira Sans", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(`+${e * 5} ft`, px + 4, py + 4);
        ctx.fillStyle = 'rgba(255,248,230,0.85)';
        ctx.fillText(`+${e * 5} ft`, px + 3, py + 3);
      }
    }
  }

  // ---------- 3. Floor features ----------
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const f = cellAt(c, r).feature;
      if (!f || !FLOOR[f]) continue;
      FLOOR[f](ctx, c * s + cam.x, r * s + cam.y, s, c, r, cellAt);
    }
  }

  // ---------- 4. Walls: ambient shadow on the floor, then bevelled tops ----------
  for (let r = sr - 1; r <= er; r++) {
    for (let c = sc - 1; c <= ec; c++) {
      if (cellAt(c, r)?.elevation !== 4) continue;
      const px = c * s + cam.x, py = r * s + cam.y;
      for (const [dc, dr] of DIRS) {
        const nb = cellAt(c + dc, r + dr);
        if (!nb || nb.elevation === 4) continue;
        const strong = dc === 1 || dr === 1;
        shadowBand(ctx, px + dc * s, py + dr * s, s, -dc, -dr, s * (strong ? 0.38 : 0.2), strong ? 0.55 : 0.35);
      }
    }
  }
  const wallP = pattern('wallTop');
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      if (cellAt(c, r).elevation !== 4) continue;
      const px = c * s + cam.x, py = r * s + cam.y;
      ctx.fillStyle = wallP;
      ctx.fillRect(px, py, s + 0.6, s + 0.6);
      const w = Math.max(2, s * 0.07);
      for (const [dc, dr] of DIRS) {
        const nb = cellAt(c + dc, r + dr);
        if (nb?.elevation === 4) continue;
        const lit = dc === -1 || dr === -1;
        ctx.fillStyle = lit ? 'rgba(255,245,220,0.2)' : 'rgba(0,0,0,0.55)';
        if (dc === 1) ctx.fillRect(px + s - w, py, w, s);
        else if (dc === -1) ctx.fillRect(px, py, w, s);
        else if (dr === 1) ctx.fillRect(px, py + s - w, s, w);
        else ctx.fillRect(px, py, s, w);
      }
    }
  }

  // ---------- 5. Doors and obstacles ----------
  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const f = cellAt(c, r).feature;
      if (!f || !OBJECTS[f]) continue;
      const px = c * s + cam.x, py = r * s + cam.y;
      ctx.save();
      OBJECTS[f](ctx, px, py, s, px + s / 2, py + s / 2, c, r, cellAt);
      ctx.restore();
    }
  }

}

// Everything that moves: shore foam, lava pulse, ripples, stream flow,
// then the atmosphere layer (fire, light, darkness, fog)
function drawAnimated(ctx, map, cam, range, now) {
  const { sc, ec, sr, er } = range;
  const s = cam.s;
  const cellAt = (c, r) => map.cells[r]?.[c];
  let animated = false;

  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      const cell = cellAt(c, r);
      const px = c * s + cam.x, py = r * s + cam.y;
      if (cell.terrain === 'water') {
        animated = true;
        for (const [dc, dr] of DIRS) {
          const nb = cellAt(c + dc, r + dr);
          if (nb && nb.terrain !== 'water' && nb.terrain !== 'none') drawFoam(ctx, px, py, s, dc, dr, now, c, r);
        }
      } else if (cell.terrain === 'lava') {
        animated = true;
        ctx.fillStyle = `rgba(255,140,40,${0.06 + 0.05 * Math.sin(now / 600 + hash(c, r) * 6)})`;
        ctx.fillRect(px, py, s, s);
      }
      if (cell.feature && FLOOR_MOTION[cell.feature]) {
        animated = true;
        ctx.save();
        FLOOR_MOTION[cell.feature](ctx, px, py, s, c, r, now, cellAt);
        ctx.restore();
      }
    }
  }

  for (let r = sr - 3; r < er + 3; r++) {
    for (let c = sc - 3; c < ec + 3; c++) {
      const f = cellAt(c, r)?.feature;
      if (!f || !ATMOSPHERE[f]) continue;
      ctx.save();
      if (ATMOSPHERE[f](ctx, c * s + cam.x, r * s + cam.y, s, now, c, r)) animated = true;
      ctx.restore();
    }
  }
  return animated;
}

// ------------------------------------------------------------
// Edge helpers
// ------------------------------------------------------------

// Paints `fill` inward from the edge facing (dc, dr) in several faint layers.
// Each layer is bounded by the same smooth wavy curve at a growing depth, so
// the layers stack into a soft falloff with an organic, non-grid boundary.
// The wave follows the whole boundary line, so neighboring squares join up;
// taperStart / taperEnd fade it out where the boundary turns a corner.
function featherEdge(ctx, fill, px, py, s, dc, dr, c, r, taperStart, taperEnd) {
  if (!fill) return;
  const LAYERS = 7, SAMPLES = 12;
  const line = dr ? r + (dr > 0 ? 1 : 0) : c + (dc > 0 ? 1 : 0);   // which grid line the edge lies on
  const base = dr ? c : r;                                          // position along that line
  const ph1 = hash(line, dr ? 1 : 2, 1) * Math.PI * 2, ph2 = hash(line, dr ? 1 : 2, 2) * Math.PI * 2;
  const reach = s * 0.36;
  const depth = u => reach * (0.62 + 0.24 * Math.sin(u * Math.PI * 1.3 + ph1) + 0.14 * Math.sin(u * Math.PI * 3.1 + ph2));
  const pt = (along, inward) =>
    dc === 1 ? [px + s - inward, py + along] : dc === -1 ? [px + inward, py + along]
      : dr === 1 ? [px + along, py + s - inward] : [px + along, py + inward];

  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.09;
  for (let l = 1; l <= LAYERS; l++) {
    const f = l / LAYERS;
    ctx.beginPath();
    ctx.moveTo(...pt(0, 0));
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      let taper = 1;
      if (taperStart) taper *= Math.min(1, t * 2.2);
      if (taperEnd) taper *= Math.min(1, (1 - t) * 2.2);
      ctx.lineTo(...pt(t * s, depth(base + t) * f * taper));
    }
    ctx.lineTo(...pt(s, 0));
    ctx.closePath();
    ctx.fill();
  }
}

// A gradient band inside cell (px, py) along the edge facing (dc, dr)
function shadowBand(ctx, px, py, s, dc, dr, width, alpha) {
  let g;
  if (dc === 1) g = ctx.createLinearGradient(px + s, 0, px + s - width, 0);
  else if (dc === -1) g = ctx.createLinearGradient(px, 0, px + width, 0);
  else if (dr === 1) g = ctx.createLinearGradient(0, py + s, 0, py + s - width);
  else g = ctx.createLinearGradient(0, py, 0, py + width);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  if (dc === 1) ctx.fillRect(px + s - width, py, width, s);
  else if (dc === -1) ctx.fillRect(px, py, width, s);
  else if (dr === 1) ctx.fillRect(px, py + s - width, s, width);
  else ctx.fillRect(px, py, s, width);
}

function edgeGradient(ctx, px, py, s, dc, dr, depth, stops) {
  let g;
  if (dc === 1) g = ctx.createLinearGradient(px + s, 0, px + s - depth, 0);
  else if (dc === -1) g = ctx.createLinearGradient(px, 0, px + depth, 0);
  else if (dr === 1) g = ctx.createLinearGradient(0, py + s, 0, py + s - depth);
  else g = ctx.createLinearGradient(0, py, 0, py + depth);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  return g;
}

function drawShore(ctx, px, py, s, dc, dr) {
  // Shallows lighten the water near land
  ctx.fillStyle = edgeGradient(ctx, px, py, s, dc, dr, s * 0.38, [[0, 'rgba(150,205,215,0.45)'], [1, 'rgba(150,205,215,0)']]);
  ctx.fillRect(px, py, s, s);
  // Wet ground on the land side
  const lx = px + dc * s, ly = py + dr * s;
  ctx.fillStyle = edgeGradient(ctx, lx, ly, s, -dc, -dr, s * 0.16, [[0, 'rgba(15,10,5,0.35)'], [1, 'rgba(15,10,5,0)']]);
  ctx.fillRect(lx, ly, s, s);
}

// Lapping foam line along a shore
function drawFoam(ctx, px, py, s, dc, dr, now, c, r) {
  ctx.strokeStyle = 'rgba(235,248,255,0.6)';
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.beginPath();
  const inset = s * (0.07 + 0.025 * Math.sin(now / 700 + hash(c, r) * 6));
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const wob = Math.sin(t * Math.PI * 3 + now / 500 + c + r) * s * 0.02;
    let x, y;
    if (dc === 1) { x = px + s - inset + wob; y = py + t * s; }
    else if (dc === -1) { x = px + inset + wob; y = py + t * s; }
    else if (dr === 1) { x = px + t * s; y = py + s - inset + wob; }
    else { x = px + t * s; y = py + inset + wob; }
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function drawLavaEdge(ctx, px, py, s, dc, dr) {
  // Heat glow spilling onto the neighboring ground
  const lx = px + dc * s, ly = py + dr * s;
  ctx.fillStyle = edgeGradient(ctx, lx, ly, s, -dc, -dr, s * 0.5, [[0, 'rgba(255,110,25,0.45)'], [1, 'rgba(255,110,25,0)']]);
  ctx.fillRect(lx, ly, s, s);
  // Cooled crust along the rim of the lava itself
  ctx.fillStyle = edgeGradient(ctx, px, py, s, dc, dr, s * 0.18, [[0, 'rgba(25,10,5,0.85)'], [1, 'rgba(25,10,5,0)']]);
  ctx.fillRect(px, py, s, s);
}

function withShadow(ctx, s, fn, alpha = 0.55) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = Math.max(2, s * 0.12);
  ctx.shadowOffsetX = s * 0.06;
  ctx.shadowOffsetY = s * 0.08;
  fn();
  ctx.restore();
}

function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  return g;
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  return g;
}

// Irregular closed blob around (cx, cy)
function blobPath(ctx, cx, cy, rad, c, r, seed, points = 10, rough = 0.22) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = rad * (1 - rough / 2 + hash(c, r, seed + i) * rough);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const p = pts[i], q = pts[(i + 1) % points];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(p[0], p[1], mx, my);
  }
  const p0 = pts[0], q0 = pts[1];
  ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + q0[0]) / 2, (p0[1] + q0[1]) / 2);
  ctx.closePath();
}

// ------------------------------------------------------------
// Floor features (drawn under walls and objects)
// ------------------------------------------------------------

// Streams run along whichever direction their neighbors continue in;
// translates (and rotates) the context so the stream lies along x
function streamFrame(ctx, px, py, s, c, r, cellAt) {
  const vertical = (cellAt(c, r - 1)?.feature === 'stream' || cellAt(c, r + 1)?.feature === 'stream') &&
    cellAt(c - 1, r)?.feature !== 'stream' && cellAt(c + 1, r)?.feature !== 'stream';
  if (vertical) { ctx.translate(px + s, py); ctx.rotate(Math.PI / 2); } else ctx.translate(px, py);
}

// Moving parts of floor features, drawn every frame over the cached ground
const FLOOR_MOTION = {
  pool(ctx, px, py, s, c, r, now) {
    const cx = px + s / 2, cy = py + s / 2;
    const t = ((now / 2200) + hash(c, r)) % 1;
    ctx.strokeStyle = `rgba(210,240,255,${0.45 * (1 - t)})`;
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.32 * t + 2, s * 0.24 * t + 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(cx - s * 0.14, cy - s * 0.14, s * 0.07, s * 0.03, -0.6, 0, Math.PI * 2); ctx.fill();
  },

  stream(ctx, px, py, s, c, r, now, cellAt) {
    streamFrame(ctx, px, py, s, c, r, cellAt);
    ctx.strokeStyle = 'rgba(200,235,255,0.45)';
    ctx.lineWidth = Math.max(1, s * 0.022);
    const off = ((now / 900) % 1) * s;
    for (let i = 0; i < 4; i++) {
      const y = s * (0.36 + i * 0.09);
      const x0 = (hash(c, r, i) * s + off) % s;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(Math.min(s, x0 + s * 0.22), y + s * 0.01); ctx.stroke();
    }
  },
};

const FLOOR = {
  ravine(ctx, px, py, s, c, r) {
    // A jagged crevice running across the cell, darkening with depth
    const left = [], right = [];
    for (let i = 0; i <= 6; i++) {
      const y = py + (i / 6) * s;
      const mid = px + s * (0.5 + (hash(c, r, i) - 0.5) * 0.18);
      const half = s * (0.16 + hash(c, r, i + 9) * 0.1);
      left.push([mid - half, y]);
      right.push([mid + half, y]);
    }
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    right.reverse().forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.fillStyle = linear(ctx, px + s * 0.3, 0, px + s * 0.7, 0, [[0, '#2a1d14'], [0.35, '#050302'], [0.65, '#050302'], [1, '#1c130c']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,130,100,0.45)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.stroke();
  },

  pool(ctx, px, py, s, c, r) {
    const cx = px + s / 2, cy = py + s / 2;
    blobPath(ctx, cx, cy, s * 0.44, c, r, 20, 12, 0.18);
    ctx.fillStyle = 'rgba(40,30,20,0.55)';
    ctx.fill();
    blobPath(ctx, cx, cy, s * 0.38, c, r, 20, 12, 0.18);
    ctx.fillStyle = radial(ctx, cx - s * 0.08, cy - s * 0.08, 0, s * 0.42, [[0, '#2f7fa3'], [0.6, '#1b5476'], [1, '#123a55']]);
    ctx.fill();
  },

  stream(ctx, px, py, s, c, r, cellAt) {
    ctx.save();
    streamFrame(ctx, px, py, s, c, r, cellAt);
    ctx.fillStyle = 'rgba(40,30,20,0.5)';
    ctx.fillRect(0, s * 0.24, s, s * 0.52);
    ctx.fillStyle = linear(ctx, 0, s * 0.28, 0, s * 0.72, [[0, '#2a6f96'], [0.5, '#1c5a80'], [1, '#2a6f96']]);
    ctx.fillRect(0, s * 0.28, s, s * 0.44);
    ctx.restore();
  },

  web(ctx, px, py, s, c, r) {
    const cx = px + s * (0.45 + hash(c, r) * 0.1), cy = py + s * (0.45 + hash(c, r, 1) * 0.1);
    ctx.strokeStyle = 'rgba(235,235,240,0.65)';
    ctx.lineWidth = Math.max(0.6, s * 0.012);
    const spokes = 9;
    const ends = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + hash(c, r, i) * 0.3;
      const len = s * (0.52 + hash(c, r, i + 20) * 0.2);
      ends.push(a);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.stroke();
    }
    for (let ring = 1; ring <= 5; ring++) {
      const rr = s * 0.09 * ring;
      ctx.beginPath();
      ends.forEach((a, i) => {
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(px + hash(c, r, i + 40) * s, py + hash(c, r, i + 50) * s, Math.max(0.8, s * 0.012), 0, Math.PI * 2); ctx.fill();
    }
  },

  rubble(ctx, px, py, s, c, r) {
    for (let i = 0; i < 9; i++) {
      const x = px + s * (0.15 + hash(c, r, i) * 0.7), y = py + s * (0.15 + hash(c, r, i + 10) * 0.7);
      const rad = s * (0.05 + hash(c, r, i + 20) * 0.08);
      withShadow(ctx, s * 0.6, () => {
        blobPath(ctx, x, y, rad, c, r, i * 13, 7, 0.45);
        ctx.fillStyle = radial(ctx, x - rad * 0.4, y - rad * 0.4, 0, rad * 1.4, [[0, '#9b958c'], [1, '#55514b']]);
        ctx.fill();
      }, 0.5);
    }
  },

  trap(ctx, px, py, s, c, r) {
    // A slightly raised pressure plate with a faint warning tint
    const x = px + s * 0.22, y = py + s * 0.22, w = s * 0.56;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x + s * 0.02, y + s * 0.03, w, w);
    ctx.fillStyle = linear(ctx, x, y, x + w, y + w, [[0, '#7a7570'], [1, '#4c4844']]);
    ctx.fillRect(x, y, w, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y + 2, w - 4, w - 4);
    ctx.fillStyle = 'rgba(200,40,30,0.18)';
    ctx.fillRect(x, y, w, w);
  },

  spike(ctx, px, py, s, c, r) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const x = px + s * (0.2 + i * 0.3), y = py + s * (0.2 + j * 0.3), rad = s * 0.1;
        withShadow(ctx, s * 0.7, () => {
          ctx.fillStyle = radial(ctx, x - rad * 0.4, y - rad * 0.4, 0, rad, [[0, '#e4e4e4'], [0.35, '#9a9a9a'], [1, '#3e3e3e']]);
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        });
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x - rad * 0.15, y - rad * 0.15, Math.max(0.6, rad * 0.15), 0, Math.PI * 2); ctx.fill();
      }
    }
  },

  // Scorch mark under the flames (flames themselves are atmosphere)
  fire(ctx, px, py, s, c, r) {
    ctx.fillStyle = radial(ctx, px + s / 2, py + s / 2, 0, s * 0.55, [[0, 'rgba(15,8,4,0.85)'], [1, 'rgba(15,8,4,0)']]);
    ctx.fillRect(px - s * 0.1, py - s * 0.1, s * 1.2, s * 1.2);
  },
};

// ------------------------------------------------------------
// Doors and obstacles (drawn over walls, with drop shadows)
// ------------------------------------------------------------

function woodGrain(ctx, x, y, w, h, vertical, c, r) {
  ctx.strokeStyle = 'rgba(30,15,5,0.35)';
  ctx.lineWidth = 1;
  const n = 4;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    if (vertical) {
      const gx = x + (w * i) / n + (hash(c, r, i) - 0.5) * 2;
      ctx.moveTo(gx, y); ctx.lineTo(gx, y + h);
    } else {
      const gy = y + (h * i) / n + (hash(c, r, i) - 0.5) * 2;
      ctx.moveTo(x, gy); ctx.lineTo(x + w, gy);
    }
    ctx.stroke();
  }
}

function door(ctx, px, py, s, open, c, r) {
  // Same footprint as the original icons: closed = centered vertical slab,
  // open = thin slab swung against the left side
  const x = px + s * (open ? 0.08 : 0.38), w = s * (open ? 0.14 : 0.24);
  const y = py + s * 0.08, h = s * 0.84;
  withShadow(ctx, s, () => {
    ctx.fillStyle = linear(ctx, x, 0, x + w, 0, [[0, '#7a4c26'], [0.5, '#8d5a2e'], [1, '#5e3a1c']]);
    ctx.fillRect(x, y, w, h);
  });
  woodGrain(ctx, x, y, w, h, true, c, r);
  ctx.fillStyle = '#2f2f33';
  for (const by of [0.2, 0.8]) ctx.fillRect(x - 1, py + s * by - s * 0.03, w + 2, s * 0.06);
  ctx.strokeStyle = '#2b1a0c';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeRect(x, y, w, h);
  if (!open) {
    ctx.fillStyle = radial(ctx, x + w / 2 - 1, py + s * 0.55 - 1, 0, s * 0.05, [[0, '#ffe7a0'], [1, '#9c7a1c']]);
    ctx.beginPath(); ctx.arc(x + w / 2, py + s * 0.55, s * 0.045, 0, Math.PI * 2); ctx.fill();
  }
}

const OBJECTS = {
  door: (ctx, px, py, s, cx, cy, c, r) => door(ctx, px, py, s, false, c, r),
  doorOpen: (ctx, px, py, s, cx, cy, c, r) => door(ctx, px, py, s, true, c, r),

  crate(ctx, px, py, s, cx, cy, c, r) {
    const x = px + s * 0.14, y = py + s * 0.14, w = s * 0.72;
    withShadow(ctx, s, () => {
      ctx.fillStyle = linear(ctx, x, y, x + w, y + w, [[0, '#b07c49'], [1, '#7a4e29']]);
      ctx.fillRect(x, y, w, w);
    });
    woodGrain(ctx, x, y, w, w, false, c, r);
    ctx.strokeStyle = '#4b2e14';
    ctx.lineWidth = s * 0.07;
    ctx.strokeRect(x + s * 0.035, y + s * 0.035, w - s * 0.07, w - s * 0.07);
    ctx.lineWidth = s * 0.06;
    ctx.beginPath(); ctx.moveTo(x + s * 0.05, y + w - s * 0.05); ctx.lineTo(x + w - s * 0.05, y + s * 0.05); ctx.stroke();
    ctx.fillStyle = '#1d1d1f';
    for (const [nx, ny] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94]]) {
      ctx.beginPath(); ctx.arc(x + w * nx, y + w * ny, Math.max(0.8, s * 0.018), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,230,190,0.18)';
    ctx.fillRect(x, y, w, Math.max(1, s * 0.02));
  },

  barrel(ctx, px, py, s, cx, cy) {
    const rad = s * 0.34;
    withShadow(ctx, s, () => {
      ctx.fillStyle = radial(ctx, cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, rad * 1.1, [[0, '#9a6633'], [0.7, '#6b4020'], [1, '#4a2b14']]);
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = 'rgba(30,15,5,0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rad * 0.62, cy + Math.sin(a) * rad * 0.62); ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); ctx.stroke();
    }
    for (const [rr, lw] of [[rad - s * 0.02, s * 0.045], [rad * 0.62, s * 0.035]]) {
      ctx.strokeStyle = '#3d3d40';
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(220,220,230,0.45)';
      ctx.lineWidth = Math.max(1, lw * 0.35);
      ctx.beginPath(); ctx.arc(cx, cy, rr, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(20,10,5,0.6)';
    ctx.beginPath(); ctx.arc(cx + rad * 0.25, cy + rad * 0.15, s * 0.03, 0, Math.PI * 2); ctx.fill();
  },

  table(ctx, px, py, s, cx, cy, c, r) {
    const x = px + s * 0.07, y = py + s * 0.18, w = s * 0.86, h = s * 0.64;
    withShadow(ctx, s, () => {
      ctx.fillStyle = linear(ctx, x, y, x, y + h, [[0, '#9a6738'], [1, '#6e4524']]);
      ctx.fillRect(x, y, w, h);
    });
    woodGrain(ctx, x, y, w, h, false, c, r);
    ctx.strokeStyle = '#3e2410';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,225,180,0.15)';
    ctx.fillRect(x, y, w, Math.max(1, s * 0.025));
    // A tankard and a plate
    const mx = px + s * (0.3 + hash(c, r) * 0.15), my = py + s * 0.45;
    ctx.fillStyle = radial(ctx, mx - s * 0.02, my - s * 0.02, 0, s * 0.07, [[0, '#c9c9c9'], [1, '#6f6f6f']]);
    ctx.beginPath(); ctx.arc(mx, my, s * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2210';
    ctx.beginPath(); ctx.arc(mx, my, s * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(235,230,215,0.9)';
    ctx.beginPath(); ctx.ellipse(px + s * 0.66, py + s * 0.52, s * 0.1, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  },

  lowWall(ctx, px, py, s, cx, cy, c, r, cellAt) {
    // Joins up with neighboring low walls into one continuous run
    const vertical = (cellAt(c, r - 1)?.feature === 'lowWall' || cellAt(c, r + 1)?.feature === 'lowWall') &&
      cellAt(c - 1, r)?.feature !== 'lowWall' && cellAt(c + 1, r)?.feature !== 'lowWall';
    const [x, y, w, h] = vertical ? [px + s * 0.3, py, s * 0.4, s] : [px, py + s * 0.3, s, s * 0.4];
    withShadow(ctx, s, () => {
      ctx.fillStyle = linear(ctx, x, y, x + (vertical ? w : 0), y + (vertical ? 0 : h), [[0, '#8a847b'], [1, '#5c574f']]);
      ctx.fillRect(x, y, w, h);
    }, 0.6);
    ctx.strokeStyle = 'rgba(30,28,25,0.75)';
    ctx.lineWidth = 1;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const o = (i + (hash(c, r, i) * 0.4)) / n;
      ctx.beginPath();
      if (vertical) { ctx.moveTo(x, y + o * h); ctx.lineTo(x + w, y + o * h); }
      else { ctx.moveTo(x + o * w, y); ctx.lineTo(x + o * w, y + h); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,250,235,0.2)';
    if (vertical) ctx.fillRect(x, y, Math.max(1, s * 0.03), h);
    else ctx.fillRect(x, y, w, Math.max(1, s * 0.03));
  },

  boulder(ctx, px, py, s, cx, cy, c, r) {
    withShadow(ctx, s, () => {
      blobPath(ctx, cx, cy, s * 0.4, c, r, 70, 9, 0.3);
      ctx.fillStyle = radial(ctx, cx - s * 0.12, cy - s * 0.14, s * 0.02, s * 0.5, [[0, '#a29d94'], [0.55, '#6f6a63'], [1, '#3f3c37']]);
      ctx.fill();
    }, 0.65);
    ctx.strokeStyle = 'rgba(25,23,20,0.6)';
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.05, cy - s * 0.2); ctx.lineTo(cx + s * 0.04, cy - s * 0.02); ctx.lineTo(cx - s * 0.02, cy + s * 0.16);
    ctx.stroke();
    ctx.fillStyle = 'rgba(85,120,60,0.45)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + (hash(c, r, i + 80) - 0.5) * s * 0.4, cy + s * 0.12 + hash(c, r, i + 90) * s * 0.12, s * 0.07, s * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  pillar(ctx, px, py, s, cx, cy) {
    withShadow(ctx, s, () => {
      ctx.fillStyle = linear(ctx, px + s * 0.1, py + s * 0.1, px + s * 0.9, py + s * 0.9, [[0, '#8d887f'], [1, '#55514b']]);
      ctx.fillRect(px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.8);
    }, 0.6);
    ctx.fillStyle = 'rgba(255,250,235,0.15)';
    ctx.fillRect(px + s * 0.1, py + s * 0.1, s * 0.8, Math.max(1, s * 0.03));
    const rad = s * 0.3;
    ctx.fillStyle = radial(ctx, cx - rad * 0.35, cy - rad * 0.35, rad * 0.05, rad * 1.05, [[0, '#ece7dc'], [0.6, '#b3ada2'], [1, '#77726a']]);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(70,66,60,0.45)';
    ctx.lineWidth = Math.max(0.8, s * 0.012);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rad * 0.72, cy + Math.sin(a) * rad * 0.72); ctx.lineTo(cx + Math.cos(a) * rad * 0.97, cy + Math.sin(a) * rad * 0.97); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(60,56,50,0.6)';
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.7, 0, Math.PI * 2); ctx.stroke();
  },

  tree(ctx, px, py, s, cx, cy, c, r) {
    // Shadow pooled to the lower right, then a layered canopy
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.ellipse(cx + s * 0.12, cy + s * 0.14, s * 0.44, s * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3d2614';
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.08, 0, Math.PI * 2); ctx.fill();
    const blobs = [[-0.16, -0.06, 0.26], [0.15, -0.12, 0.25], [0.04, 0.16, 0.27], [-0.1, 0.14, 0.2], [0.16, 0.1, 0.2], [0, -0.02, 0.24]];
    blobs.forEach(([ox, oy, rr], i) => {
      const x = cx + ox * s + (hash(c, r, i) - 0.5) * s * 0.06, y = cy + oy * s + (hash(c, r, i + 7) - 0.5) * s * 0.06;
      const rad = rr * s * (0.9 + hash(c, r, i + 14) * 0.2);
      ctx.fillStyle = radial(ctx, x - rad * 0.35, y - rad * 0.4, rad * 0.1, rad, [[0, '#4f8a3a'], [0.6, '#2f5f27'], [1, '#1a3a18']]);
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    });
    // Leafy fringe and sunlit highlights
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const rr = s * (0.36 + hash(c, r, i + 30) * 0.1);
      ctx.fillStyle = hash(c, r, i + 60) > 0.5 ? '#264d22' : '#33642b';
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, s * 0.05, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(160,210,110,0.28)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath(); ctx.arc(cx - s * 0.12 + hash(c, r, i + 70) * s * 0.18, cy - s * 0.16 + hash(c, r, i + 75) * s * 0.16, s * 0.06, 0, Math.PI * 2); ctx.fill();
    }
  },

  statue(ctx, px, py, s, cx, cy) {
    withShadow(ctx, s, () => {
      ctx.fillStyle = linear(ctx, px + s * 0.14, py + s * 0.14, px + s * 0.86, py + s * 0.86, [[0, '#7c776f'], [1, '#4a4640']]);
      ctx.fillRect(px + s * 0.14, py + s * 0.14, s * 0.72, s * 0.72);
    }, 0.6);
    ctx.strokeStyle = 'rgba(255,250,235,0.18)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.strokeRect(px + s * 0.2, py + s * 0.2, s * 0.6, s * 0.6);
    // Figure seen from above: shoulders, arms, head
    ctx.fillStyle = radial(ctx, cx - s * 0.06, cy - s * 0.04, s * 0.02, s * 0.3, [[0, '#e9e5dc'], [1, '#8f8a80']]);
    ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.05, s * 0.24, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.04, s * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(80,76,70,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.04, s * 0.11, 0, Math.PI * 2); ctx.stroke();
  },

  chest(ctx, px, py, s, cx, cy, c, r) {
    const x = px + s * 0.2, y = py + s * 0.3, w = s * 0.6, h = s * 0.42;
    withShadow(ctx, s, () => {
      ctx.fillStyle = linear(ctx, x, y, x, y + h, [[0, '#9a6232'], [1, '#64391a']]);
      ctx.fillRect(x, y, w, h);
    });
    woodGrain(ctx, x, y, w, h, false, c, r);
    ctx.fillStyle = 'rgba(255,225,180,0.2)';
    ctx.fillRect(x, y, w, h * 0.3);
    ctx.fillStyle = linear(ctx, 0, y, 0, y + h, [[0, '#e8c25a'], [1, '#8f6b17']]);
    for (const bx of [0.18, 0.74]) ctx.fillRect(x + w * bx, y, w * 0.08, h);
    ctx.fillRect(x + w * 0.44, y + h * 0.3, w * 0.12, h * 0.28);
    ctx.fillStyle = '#2a1a08';
    ctx.fillRect(x + w * 0.485, y + h * 0.4, w * 0.03, h * 0.1);
    ctx.strokeStyle = '#3a210c';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.strokeRect(x, y, w, h);
  },
};

// ------------------------------------------------------------
// Atmosphere (on top of everything on the ground)
// ------------------------------------------------------------

let fogPuff = null;
function getFogPuff() {
  if (fogPuff) return fogPuff;
  fogPuff = document.createElement('canvas');
  fogPuff.width = fogPuff.height = 128;
  const g = fogPuff.getContext('2d');
  g.fillStyle = radial(g, 64, 64, 0, 64, [[0, 'rgba(210,215,225,0.9)'], [0.5, 'rgba(190,198,210,0.45)'], [1, 'rgba(180,188,200,0)']]);
  g.fillRect(0, 0, 128, 128);
  return fogPuff;
}

const ATMOSPHERE = {
  fire(ctx, px, py, s, now, c, r) {
    const cx = px + s / 2, cy = py + s * 0.55;
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.85 + 0.15 * Math.sin(now / 90 + c * 3) * Math.sin(now / 137 + r);
    ctx.fillStyle = radial(ctx, cx, cy, 0, s * 1.6 * flick, [[0, 'rgba(255,140,40,0.32)'], [1, 'rgba(255,90,20,0)']]);
    ctx.fillRect(cx - s * 1.7, cy - s * 1.7, s * 3.4, s * 3.4);
    for (let i = 0; i < 5; i++) {
      const ph = now / (160 + i * 37) + hash(c, r, i) * 9;
      const ox = (i - 2) * s * 0.1 + Math.sin(ph) * s * 0.03;
      const hgt = s * (0.32 + 0.12 * Math.sin(ph * 1.3)) * (i === 2 ? 1.3 : 1);
      const wid = s * 0.12;
      for (const [col, k] of [['rgba(220,50,10,0.6)', 1], ['rgba(255,140,30,0.7)', 0.72], ['rgba(255,230,120,0.8)', 0.42]]) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx + ox - wid * k, cy + s * 0.12);
        ctx.quadraticCurveTo(cx + ox - wid * k, cy - hgt * k * 0.4, cx + ox + Math.sin(ph * 2) * s * 0.03, cy - hgt * k);
        ctx.quadraticCurveTo(cx + ox + wid * k, cy - hgt * k * 0.4, cx + ox + wid * k, cy + s * 0.12);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Embers
    ctx.fillStyle = 'rgba(255,200,90,0.9)';
    for (let i = 0; i < 4; i++) {
      const t = ((now / 1400) + hash(c, r, i + 20)) % 1;
      ctx.beginPath();
      ctx.arc(cx + (hash(c, r, i + 30) - 0.5) * s * 0.5 + Math.sin(t * 6) * s * 0.05, cy - t * s * 0.9, Math.max(0.8, s * 0.018 * (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }
    return true;
  },

  light(ctx, px, py, s, now, c, r) {
    const cx = px + s / 2, cy = py + s / 2;
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.92 + 0.08 * Math.sin(now / 160 + c);
    ctx.fillStyle = radial(ctx, cx, cy, 0, s * 2.6 * flick, [[0, 'rgba(255,215,140,0.38)'], [0.5, 'rgba(255,190,100,0.14)'], [1, 'rgba(255,180,90,0)']]);
    ctx.fillRect(cx - s * 2.8, cy - s * 2.8, s * 5.6, s * 5.6);
    ctx.globalCompositeOperation = 'source-over';
    // A lantern on the floor
    ctx.fillStyle = '#2b2b2f';
    ctx.fillRect(cx - s * 0.1, cy - s * 0.1, s * 0.2, s * 0.2);
    ctx.fillStyle = radial(ctx, cx, cy, 0, s * 0.09, [[0, '#fff6d0'], [1, '#ffb43c']]);
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.07, 0, Math.PI * 2); ctx.fill();
    return true;
  },

  // A torch in an iron bracket, flickering with a warm glow
  torch(ctx, px, py, s, now, c, r) {
    const cx = px + s / 2, cy = py + s * 0.42;
    const flick = 0.88 + 0.12 * Math.sin(now / 80 + c * 5) * Math.sin(now / 131 + r * 3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = radial(ctx, cx, cy, 0, s * 2.2 * flick, [[0, 'rgba(255,170,70,0.34)'], [0.45, 'rgba(255,140,50,0.12)'], [1, 'rgba(255,120,40,0)']]);
    ctx.fillRect(cx - s * 2.4, cy - s * 2.4, s * 4.8, s * 4.8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#4a3420';
    ctx.fillRect(cx - s * 0.04, cy, s * 0.08, s * 0.36);
    ctx.fillStyle = '#2b2b2f';
    ctx.fillRect(cx - s * 0.09, cy + s * 0.02, s * 0.18, s * 0.06);
    const sway = Math.sin(now / 110 + c) * s * 0.02;
    for (const [col, k] of [['rgba(230,70,15,0.75)', 1], ['rgba(255,160,40,0.85)', 0.7], ['rgba(255,240,150,0.95)', 0.4]]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.07 * k, cy);
      ctx.quadraticCurveTo(cx - s * 0.08 * k, cy - s * 0.12 * k * flick, cx + sway, cy - s * 0.24 * k * flick);
      ctx.quadraticCurveTo(cx + s * 0.08 * k, cy - s * 0.12 * k * flick, cx + s * 0.07 * k, cy);
      ctx.closePath();
      ctx.fill();
    }
    return true;
  },

  darkness(ctx, px, py, s) {
    const cx = px + s / 2, cy = py + s / 2;
    ctx.fillStyle = radial(ctx, cx, cy, s * 0.2, s * 1.7, [[0, 'rgba(2,2,8,0.85)'], [0.6, 'rgba(2,2,8,0.45)'], [1, 'rgba(2,2,8,0)']]);
    ctx.fillRect(cx - s * 1.8, cy - s * 1.8, s * 3.6, s * 3.6);
  },

  fog(ctx, px, py, s, now, c, r) {
    const puff = getFogPuff();
    const t = now / 1000;
    for (let i = 0; i < 4; i++) {
      const ph = hash(c, r, i) * Math.PI * 2;
      const x = px + s * (0.5 + (hash(c, r, i + 5) - 0.5) * 0.8) + Math.sin(t * 0.25 + ph) * s * 0.2;
      const y = py + s * (0.5 + (hash(c, r, i + 9) - 0.5) * 0.8) + Math.cos(t * 0.2 + ph) * s * 0.12;
      const rad = s * (0.7 + hash(c, r, i + 13) * 0.4);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(puff, x - rad, y - rad, rad * 2, rad * 2);
    }
    return true;
  },
};
