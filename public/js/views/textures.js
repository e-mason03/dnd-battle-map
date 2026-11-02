// ============================================================
// Procedural, seamlessly tiling terrain textures for the battle
// map. Each texture is a 256px tile that spans 4×4 grid squares,
// so the surface flows across squares instead of repeating per cell.
// Generated once on first use (~tens of ms), then reused as patterns.
// ============================================================

const TEX = 256;
export const TEX_CELLS = 4;
export const CELL_PX = TEX / TEX_CELLS;

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise on a lattice that wraps at the texture edge (so it tiles)
function noiseLayer(period, seed) {
  const rnd = mulberry32(seed);
  const lat = Float32Array.from({ length: period * period }, rnd);
  const out = new Float32Array(TEX * TEX);
  const step = TEX / period;
  for (let y = 0; y < TEX; y++) {
    const gy = y / step, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy), y1 = (y0 + 1) % period;
    for (let x = 0; x < TEX; x++) {
      const gx = x / step, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx), x1 = (x0 + 1) % period;
      const a = lat[y0 * period + x0], b = lat[y0 * period + x1], c = lat[y1 * period + x0], d = lat[y1 * period + x1];
      out[y * TEX + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(seed, periods = [4, 8, 16, 32, 64]) {
  const out = new Float32Array(TEX * TEX);
  let total = 0, amp = 1;
  periods.forEach((p, i) => {
    const n = noiseLayer(p, seed + i * 101);
    for (let k = 0; k < out.length; k++) out[k] += n[k] * amp;
    total += amp;
    amp *= 0.55;
  });
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}

const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// Maps 0..1 onto a list of color stops
function ramp(stops) {
  const cols = stops.map(hexRgb);
  return v => {
    const t = Math.max(0, Math.min(0.9999, v)) * (cols.length - 1);
    const i = Math.floor(t), f = t - i;
    const a = cols[i], b = cols[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  return c;
}

// Paints every pixel from fn(x, y, i) → [r, g, b]
function paintPixels(g, fn) {
  const img = g.createImageData(TEX, TEX);
  for (let y = 0, i = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++, i++) {
      const [r, gg, b] = fn(x, y, i);
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

// Draws fn at (x, y) and at its wrapped copies so details tile across edges
function wrapped(x, y, margin, fn) {
  for (const ox of [0, -TEX, TEX]) {
    for (const oy of [0, -TEX, TEX]) {
      const X = x + ox, Y = y + oy;
      if (X > -margin && X < TEX + margin && Y > -margin && Y < TEX + margin) fn(X, Y);
    }
  }
}

// Even stretch of noise to 0..1 (noise clusters around the middle)
const contrast = (v, k = 1.8) => Math.max(0, Math.min(1, (v - 0.5) * k + 0.5));

const MAKERS = {
  grass(g, rnd) {
    const n = fbm(11), dry = fbm(12, [8, 16, 32]);
    const base = ramp(['#22401c', '#33582a', '#46733a', '#5a8a44']);
    const straw = hexRgb('#8a8a4a');
    paintPixels(g, (x, y, i) => {
      const c = base(contrast(n[i], 2));
      const d = Math.max(0, (dry[i] - 0.58) * 2.2);
      return [c[0] + (straw[0] - c[0]) * d, c[1] + (straw[1] - c[1]) * d, c[2] + (straw[2] - c[2]) * d];
    });
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * TEX, y = rnd() * TEX, len = 3 + rnd() * 6, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.1;
      const light = rnd() > 0.55;
      g.strokeStyle = light ? `rgba(120,170,80,${0.25 + rnd() * 0.3})` : `rgba(15,35,12,${0.25 + rnd() * 0.3})`;
      g.lineWidth = 0.8 + rnd() * 0.6;
      wrapped(x, y, 10, (X, Y) => { g.beginPath(); g.moveTo(X, Y); g.lineTo(X + Math.cos(ang) * len, Y + Math.sin(ang) * len); g.stroke(); });
    }
    for (let i = 0; i < 14; i++) {
      const x = rnd() * TEX, y = rnd() * TEX;
      g.fillStyle = rnd() > 0.5 ? 'rgba(245,240,210,0.8)' : 'rgba(240,200,70,0.8)';
      wrapped(x, y, 3, (X, Y) => { g.beginPath(); g.arc(X, Y, 1.2, 0, Math.PI * 2); g.fill(); });
    }
  },

  dirt(g, rnd) {
    const n = fbm(21), m = fbm(22, [16, 32, 64]);
    const base = ramp(['#3b2817', '#55391f', '#6c4b2a', '#82603a']);
    paintPixels(g, (x, y, i) => {
      const c = base(contrast(n[i] * 0.7 + m[i] * 0.3, 2));
      const sp = (m[i] * 997) % 1 > 0.92 ? -18 : 0;
      return [c[0] + sp, c[1] + sp, c[2] + sp];
    });
    for (let i = 0; i < 70; i++) {
      const x = rnd() * TEX, y = rnd() * TEX, r = 1.5 + rnd() * 3, tone = 90 + rnd() * 50;
      wrapped(x, y, 8, (X, Y) => {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath(); g.ellipse(X + 1, Y + 1.2, r, r * 0.75, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = `rgb(${tone},${tone * 0.85},${tone * 0.7})`;
        g.beginPath(); g.ellipse(X, Y, r, r * 0.75, rnd() * 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath(); g.arc(X - r * 0.3, Y - r * 0.3, r * 0.35, 0, Math.PI * 2); g.fill();
      });
    }
  },

  sand(g, rnd) {
    const n = fbm(31, [8, 16, 32, 64]);
    const base = ramp(['#a88a52', '#c2a268', '#d6b97f', '#e4cb97']);
    paintPixels(g, (x, y, i) => {
      // Wind ripples: a wave that tiles horizontally, warped by noise
      const rip = Math.sin((y / TEX) * Math.PI * 2 * 14 + n[i] * 9) * 0.06;
      return base(contrast(n[i], 1.6) + rip);
    });
    g.fillStyle = 'rgba(90,60,30,0.25)';
    for (let i = 0; i < 1600; i++) g.fillRect(rnd() * TEX, rnd() * TEX, 1, 1);
    g.fillStyle = 'rgba(255,250,230,0.35)';
    for (let i = 0; i < 900; i++) g.fillRect(rnd() * TEX, rnd() * TEX, 1, 1);
  },

  snow(g, rnd) {
    const n = fbm(41, [4, 8, 16, 32]);
    const base = ramp(['#b7c6d6', '#d4dee9', '#ebf1f7', '#ffffff']);
    paintPixels(g, (x, y, i) => base(contrast(n[i], 1.8)));
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${0.6 + rnd() * 0.4})`;
      g.fillRect(rnd() * TEX, rnd() * TEX, 1.5, 1.5);
    }
  },

  stone(g, rnd) {
    // Irregular flagstones with mortar, per-stone tint, bevels and cracks
    const n = fbm(51, [8, 16, 32, 64]);
    const base = ramp(['#4a4845', '#5d5a56', '#6f6b66', '#817d77']);
    paintPixels(g, (x, y, i) => base(contrast(n[i], 1.6)));
    const rows = [52, 52, 50, 52, 50];
    let y = 0;
    for (const h of rows) {
      let x = rnd() * TEX;
      const end = x + TEX;
      while (x < end - 1) {
        const w = Math.min(end - x, 44 + rnd() * 50);
        const sx = x, sw = w, tint = rnd();
        wrapped(sx, y, TEX, (X, Y) => {
          g.fillStyle = tint > 0.5 ? `rgba(255,255,255,${(tint - 0.5) * 0.14})` : `rgba(0,0,0,${(0.5 - tint) * 0.22})`;
          g.fillRect(X + 2, Y + 2, sw - 4, h - 4);
          g.fillStyle = 'rgba(255,255,255,0.12)';
          g.fillRect(X + 2, Y + 2, sw - 4, 2);
          g.fillRect(X + 2, Y + 2, 2, h - 4);
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(X + 2, Y + h - 4, sw - 4, 2);
          g.fillRect(X + sw - 4, Y + 2, 2, h - 4);
          g.strokeStyle = '#24221f';
          g.lineWidth = 2.5;
          g.strokeRect(X + 0.5, Y + 0.5, sw - 1, h - 1);
        });
        if (rnd() > 0.7) {
          const cx = sx + rnd() * sw, cy = y + rnd() * h;
          g.strokeStyle = 'rgba(20,18,16,0.55)';
          g.lineWidth = 1;
          wrapped(cx, cy, 30, (X, Y) => {
            g.beginPath(); g.moveTo(X, Y);
            g.lineTo(X + (rnd() - 0.5) * 18, Y + (rnd() - 0.5) * 14);
            g.lineTo(X + (rnd() - 0.5) * 26, Y + (rnd() - 0.5) * 20);
            g.stroke();
          });
        }
        x += w;
      }
      y += h;
    }
  },

  wood(g, rnd) {
    // Floor planks: 8 rows, staggered joints, grain and nails
    const n = fbm(61, [4, 8, 16]);
    const base = ramp(['#4a2f19', '#5e3d21', '#714b2a', '#855a33']);
    paintPixels(g, (x, y, i) => {
      const grain = Math.sin((y / TEX) * Math.PI * 2 * 40 + n[i] * 14) * 0.08;
      return base(contrast(n[i], 1.4) + grain);
    });
    const H = TEX / 8;
    for (let row = 0; row < 8; row++) {
      const y = row * H;
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,220,180' : '0,0,0'},${rnd() * 0.1})`;
      g.fillRect(0, y, TEX, H);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, y, TEX, 1.5);
      g.fillStyle = 'rgba(255,220,180,0.08)';
      g.fillRect(0, y + 1.5, TEX, 1);
      let x = rnd() * 120;
      while (x < TEX) {
        const jx = x;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(jx, y, 1.5, H);
        g.fillStyle = '#1e1a16';
        for (const ny of [y + 6, y + H - 6]) {
          wrapped(jx + 5, ny, 3, (X, Y) => { g.beginPath(); g.arc(X, Y, 1.3, 0, Math.PI * 2); g.fill(); });
          wrapped(jx - 5, ny, 3, (X, Y) => { g.beginPath(); g.arc(X, Y, 1.3, 0, Math.PI * 2); g.fill(); });
        }
        x += 70 + rnd() * 110;
      }
    }
  },

  water(g) {
    const n = fbm(71, [4, 8, 16, 32]);
    const c1 = noiseLayer(16, 72), c2 = noiseLayer(32, 73);
    const base = ramp(['#0d2a42', '#153c5c', '#1d5275', '#2a6a8e']);
    paintPixels(g, (x, y, i) => {
      const c = base(contrast(n[i], 1.6));
      // Caustics: bright where the noise ridges line up
      const ridge = Math.pow(1 - Math.abs(c1[i] * 2 - 1), 6) * 0.6 + Math.pow(1 - Math.abs(c2[i] * 2 - 1), 8) * 0.5;
      return [c[0] + ridge * 90, c[1] + ridge * 120, c[2] + ridge * 130];
    });
  },

  lava(g) {
    const n = fbm(81, [4, 8, 16, 32]);
    const r1 = noiseLayer(8, 82), r2 = noiseLayer(16, 83);
    const crust = ramp(['#120705', '#24100a', '#361a10']);
    const glow = ramp(['#8a1a04', '#e0440a', '#ff9a1f', '#ffe27a']);
    paintPixels(g, (x, y, i) => {
      const ridge = Math.max(Math.pow(1 - Math.abs(r1[i] * 2 - 1), 5), Math.pow(1 - Math.abs(r2[i] * 2 - 1), 7) * 0.9);
      const heat = Math.max(0, Math.min(1, ridge * 1.3 + (n[i] - 0.5) * 0.6));
      if (heat > 0.35) return glow((heat - 0.35) / 0.65);
      return crust(n[i]);
    });
  },

  void(g, rnd) {
    const n = fbm(91, [4, 8, 16]);
    paintPixels(g, (x, y, i) => {
      const v = Math.max(0, n[i] - 0.45) * 2;
      return [8 + v * 40, 6 + v * 14, 18 + v * 60];
    });
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(220,220,255,${0.3 + rnd() * 0.7})`;
      const r = rnd() > 0.9 ? 1.4 : 0.7;
      g.beginPath(); g.arc(rnd() * TEX, rnd() * TEX, r, 0, Math.PI * 2); g.fill();
    }
  },

  // Top of a wall: rough dressed stone in running bond
  wallTop(g, rnd) {
    const n = fbm(101, [8, 16, 32]);
    const base = ramp(['#26241f', '#34312c', '#43403a', '#4f4b44']);
    paintPixels(g, (x, y, i) => base(contrast(n[i], 1.5)));
    const H = TEX / 12;
    for (let row = 0; row < 12; row++) {
      const y = row * H;
      let x = (row % 2) * 20 + rnd() * 10;
      const end = x + TEX;
      while (x < end - 1) {
        const w = Math.min(end - x, 32 + rnd() * 26);
        const sx = x, tint = rnd();
        wrapped(sx, y, TEX, (X, Y) => {
          g.fillStyle = tint > 0.5 ? `rgba(255,255,255,${(tint - 0.5) * 0.1})` : `rgba(0,0,0,${(0.5 - tint) * 0.25})`;
          g.fillRect(X + 1.5, Y + 1.5, w - 3, H - 3);
          g.fillStyle = 'rgba(255,255,255,0.1)';
          g.fillRect(X + 1.5, Y + 1.5, w - 3, 1.5);
          g.strokeStyle = '#141311';
          g.lineWidth = 2;
          g.strokeRect(X + 0.5, Y + 0.5, w - 1, H - 1);
        });
        x += w;
      }
    }
  },
};

const textures = new Map();
const patternCache = new WeakMap();

export function getTexture(name) {
  let c = textures.get(name);
  if (!c && MAKERS[name]) {
    c = canvas();
    MAKERS[name](c.getContext('2d'), mulberry32(name.length * 7919 + name.charCodeAt(0)));
    textures.set(name, c);
  }
  return c || null;
}

// Grayscale shading spanning 16×16 squares (drawn 4× larger than other
// textures): darkens hollows and lifts rises, independent of the grid
let macroTex = null;
function getMacroTexture() {
  if (macroTex) return macroTex;
  macroTex = canvas();
  const g = macroTex.getContext('2d');
  const n = fbm(5, [2, 4, 8, 16]);
  const img = g.createImageData(TEX, TEX);
  for (let i = 0; i < n.length; i++) {
    const v = contrast(n[i], 2.2) - 0.5;
    if (v < 0) { img.data[i * 4 + 3] = Math.min(255, -v * 150); }
    else { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = v * 70; }
  }
  g.putImageData(img, 0, 0);
  return macroTex;
}

export function getMacroPattern(ctx) {
  let m = patternCache.get(ctx);
  if (!m) { m = new Map(); patternCache.set(ctx, m); }
  if (!m.has('__macro')) m.set('__macro', ctx.createPattern(getMacroTexture(), 'repeat'));
  return m.get('__macro');
}

// Patterns belong to a 2D context, so cache them per context
export function getPattern(ctx, name) {
  let m = patternCache.get(ctx);
  if (!m) { m = new Map(); patternCache.set(ctx, m); }
  let p = m.get(name);
  if (!p) {
    const tex = getTexture(name);
    if (!tex) return null;
    p = ctx.createPattern(tex, 'repeat');
    m.set(name, p);
  }
  return p;
}

// Small preview (one grid square) for palette buttons
const swatches = new Map();
export function textureSwatch(name) {
  if (swatches.has(name)) return swatches.get(name);
  const tex = getTexture(name);
  if (!tex) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  c.getContext('2d').drawImage(tex, 0, 0, CELL_PX * 1.5, CELL_PX * 1.5, 0, 0, 48, 48);
  const url = c.toDataURL();
  swatches.set(name, url);
  return url;
}
