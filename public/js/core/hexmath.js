// ============================================================
// Hex grid math — offset coords ("col,row"), flat (odd-q) or pointy (odd-r)
// ============================================================

export const hexKey = (c, r) => `${c},${r}`;
export const parseHexKey = k => k.split(',').map(Number);

function offsetToCube(c, r, orientation) {
  if (orientation === 'pointy') {
    const q = c - (r - (r & 1)) / 2;
    return { q, r, s: -q - r };
  }
  const rr = r - (c - (c & 1)) / 2;
  return { q: c, r: rr, s: -c - rr };
}

function cubeToOffset(q, r, orientation) {
  if (orientation === 'pointy') return [q + (r - (r & 1)) / 2, r];
  return [q, r + (q - (q & 1)) / 2];
}

export function hexDistance(a, b, orientation) {
  const A = offsetToCube(a[0], a[1], orientation), B = offsetToCube(b[0], b[1], orientation);
  return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s));
}

const CUBE_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function hexNeighbors(c, r, orientation) {
  const { q, r: cr } = offsetToCube(c, r, orientation);
  return CUBE_DIRS.map(([dq, dr]) => cubeToOffset(q + dq, cr + dr, orientation));
}

// Hexes on the straight line from a to b, both ends included
export function hexLine(a, b, orientation) {
  const A = offsetToCube(a[0], a[1], orientation), B = offsetToCube(b[0], b[1], orientation);
  const n = hexDistance(a, b, orientation);
  const out = [];
  for (let i = 0; i <= n; i++) {
    // Nudge off exact ties so the line doesn't wobble between two hexes
    const t = n ? i / n : 0;
    let q = A.q + (B.q - A.q) * t + 1e-6, r = A.r + (B.r - A.r) * t + 1e-6, s = A.s + (B.s - A.s) * t - 2e-6;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    out.push(cubeToOffset(rq, rr, orientation));
  }
  return out;
}

// Pixel center of a hex, in map space (before camera transform)
export function hexCenter(c, r, size, orientation) {
  if (orientation === 'pointy') {
    const w = Math.sqrt(3) * size;
    return { x: w * (c + 0.5 * (r & 1)) + w / 2, y: size * 1.5 * r + size };
  }
  const h = Math.sqrt(3) * size;
  return { x: size * 1.5 * c + size, y: h * (r + 0.5 * (c & 1)) + h / 2 };
}

export function hexCorners(cx, cy, size, orientation) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI / 180 * (60 * i - (orientation === 'pointy' ? 30 : 0));
    pts.push([cx + size * Math.cos(ang), cy + size * Math.sin(ang)]);
  }
  return pts;
}

// Map-space pixel → offset hex coords
export function pixelToHex(x, y, size, orientation) {
  let q, r;
  if (orientation === 'pointy') {
    const w = Math.sqrt(3) * size;
    const px = x - w / 2, py = y - size;
    q = (Math.sqrt(3) / 3 * px - py / 3) / size;
    r = (2 / 3 * py) / size;
  } else {
    const h = Math.sqrt(3) * size;
    const px = x - size, py = y - h / 2;
    q = (2 / 3 * px) / size;
    r = (-px / 3 + Math.sqrt(3) / 3 * py) / size;
  }
  // cube round
  let s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return cubeToOffset(rq, rr, orientation);
}
