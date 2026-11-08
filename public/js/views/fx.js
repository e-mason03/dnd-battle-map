// ============================================================
// Battle FX — short, generic animations for moves, attacks,
// spells, heals and floating combat text. Everything is in map
// cell units; draw() converts with the current camera.
// ============================================================

import { DAMAGE_COLORS } from '../constants.js';
import { areaOf } from '../core/aoe.js';

const effects = [];
const moves = new Map();    // tokenId → { path, start, dur }
const shakes = new Map();   // tokenId → { start, dur }
const lunges = new Map();   // tokenId → { start, dur, dx, dy }
let sparks = [];

const now = () => performance.now();
const ease = t => 1 - (1 - t) ** 3;

export function isAnimating() {
  return effects.length > 0 || moves.size > 0 || shakes.size > 0 || lunges.size > 0 || sparks.length > 0;
}

// ---------------- Token motion ----------------

export function animateMove(tokenId, path) {
  if (!path || path.length < 2) return;
  const dur = Math.min(1600, 140 * (path.length - 1) + 120);
  moves.set(tokenId, { path, start: now(), dur });
}

// Returns the animated {col,row} offset for a token (or null)
export function tokenOffset(tok, t = now()) {
  let col = tok.col, row = tok.row;
  const mv = moves.get(tok.id);
  if (mv) {
    const p = Math.min(1, (t - mv.start) / mv.dur);
    if (p >= 1) moves.delete(tok.id);
    else {
      const f = p * (mv.path.length - 1);
      const i = Math.floor(f), k = f - i;
      const a = mv.path[i], b = mv.path[Math.min(i + 1, mv.path.length - 1)];
      col = a[0] + (b[0] - a[0]) * k;
      row = a[1] + (b[1] - a[1]) * k;
    }
  }
  const lg = lunges.get(tok.id);
  if (lg) {
    const p = (t - lg.start) / lg.dur;
    if (p >= 1) lunges.delete(tok.id);
    else if (p > 0) { const s = Math.sin(p * Math.PI) * 0.28; col += lg.dx * s; row += lg.dy * s; }
  }
  const sh = shakes.get(tok.id);
  if (sh) {
    const p = (t - sh.start) / sh.dur;
    if (p >= 1) shakes.delete(tok.id);
    else if (p > 0) col += Math.sin(p * 40) * 0.08 * (1 - p);
  }
  return { col, row };
}

// ---------------- Combat effects ----------------

function colorFor(type) { return DAMAGE_COLORS[type] || '#ffd36b'; }

function addText(x, y, text, color, delay = 0, big = false) {
  effects.push({ kind: 'text', x, y, text, color, big, start: now() + delay, dur: big ? 1500 : 1200 });
}

function burst(x, y, color, delay, count = 14, speed = 1.6) {
  const t0 = now() + delay;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (0.4 + Math.random()) * speed;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, start: t0, dur: 450 + Math.random() * 300 });
  }
}

// centerOf(tokenId) → { x, y } in cell units (center), or null
export function playAction(op, centerOf) {
  const a = op.action || {};
  const from = centerOf(op.actorId);
  const color = colorFor(a.kind === 'heal' ? 'healing' : a.dmgType);
  const t0 = now();
  let impactDelay = 0;

  // Cones, lines and cubes: a wave sweeping out from the caster across the area
  if (op.point && a.radius && a.shape && op.caster) {
    const area = areaOf(a, op.caster, op.point);
    const L = a.radius / 5 + (op.caster.size || 1) + 1;
    const cells = [];
    for (let r = Math.floor(op.caster.row - L); r <= op.caster.row + L; r++) {
      for (let c = Math.floor(op.caster.col - L); c <= op.caster.col + L; c++) {
        if (area.test(c, r)) cells.push([c, r, Math.hypot(c + 0.5 - area.origin[0], r + 0.5 - area.origin[1])]);
      }
    }
    effects.push({ kind: 'area', cells, color, start: t0, dur: 900 + a.radius * 8 });
    const far = cells.reduce((m, x) => Math.max(m, x[2]), 0);
    for (const [c, r, d] of cells.filter((_, i) => i % 3 === 0)) burst(c + 0.5, r + 0.5, color, d * 55, 4, 0.5);
    impactDelay = Math.min(700, far * 55) + 120;
  } else if (op.point && a.radius) {
    // Round AoE spells: projectile to the point, then an explosion ring
    const to = { x: op.point[0] + 0.5, y: op.point[1] + 0.5 };
    const travel = from ? 380 : 0;
    if (from) effects.push({ kind: 'orb', from, to, color, start: t0, dur: travel });
    effects.push({ kind: 'blast', x: to.x, y: to.y, r: a.radius / 5, color, start: t0 + travel, dur: 650 });
    burst(to.x, to.y, color, travel, 30, a.radius / 5);
    impactDelay = travel + 150;
  }

  op.results?.forEach((r, i) => {
    const to = centerOf(r.targetId);
    if (!to) return;
    const stagger = i * (a.kind === 'auto' ? 110 : 60);
    let delay = impactDelay + stagger;

    if (!op.point || !a.radius) {
      if (a.kind === 'melee') {
        if (from && op.actorId) lunges.set(op.actorId, { start: t0 + stagger, dur: 260, dx: Math.sign(to.x - from.x), dy: Math.sign(to.y - from.y) });
        effects.push({ kind: 'slash', x: to.x, y: to.y, color: r.crit ? '#ffd700' : color, start: t0 + stagger + 110, dur: 320, flip: i % 2 });
        delay = stagger + 200;
      } else if (a.kind === 'heal') {
        effects.push({ kind: 'heal', x: to.x, y: to.y, start: t0 + stagger, dur: 1000 });
        delay = stagger + 250;
      } else if (from) {
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        const travel = Math.min(700, 120 + dist * 45);
        const kind = a.kind === 'ranged' ? 'arrow' : 'orb';
        effects.push({ kind, from, to: r.hit === false && a.kind !== 'save' ? { x: to.x + 0.6, y: to.y - 0.5 } : to, color, start: t0 + stagger, dur: travel });
        delay = stagger + travel;
      }
    }

    // Impact + numbers
    if (a.kind === 'heal') {
      addText(to.x, to.y, `+${r.heal}`, DAMAGE_COLORS.healing, delay);
      burst(to.x, to.y, DAMAGE_COLORS.healing, delay, 10, 0.8);
    } else if (r.hit === false && !r.save) {
      addText(to.x, to.y, 'MISS', '#b9b9b9', delay);
    } else {
      if (r.damage > 0) {
        shakes.set(r.targetId, { start: now() + delay, dur: 320 });
        if (!op.point) burst(to.x, to.y, color, delay, r.crit ? 22 : 12);
        if (r.crit) {
          effects.push({ kind: 'flash', start: t0 + delay, dur: 260 });
          addText(to.x, to.y - 0.35, 'CRITICAL!', '#ffd700', delay, true);
        }
      }
      const prefix = r.save?.success ? 'SAVED ' : '';
      addText(to.x, to.y + (r.crit ? 0.25 : 0), r.damage > 0 ? `${prefix}-${r.damage}` : (prefix || 'NO EFFECT'), r.save?.success ? '#c8c8ff' : '#ff5a4f', delay + 20, r.crit);
    }
  });
}

export function ping(x, y, color = '#f5a623') {
  effects.push({ kind: 'ping', x, y, color, start: now(), dur: 1400 });
}

// ---------------- Drawing ----------------

export function draw(ctx, cam, W, H) {
  const t = now();
  const S = cam.s;
  const X = x => x * S + cam.x;
  const Y = y => y * S + cam.y;

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const p = (t - e.start) / e.dur;
    if (p >= 1) { effects.splice(i, 1); continue; }
    if (p < 0) continue;
    ctx.save();
    switch (e.kind) {
      case 'slash': {
        const r = S * 0.55;
        const a0 = e.flip ? Math.PI * 0.15 : Math.PI * 0.85;
        const sweep = (e.flip ? 1 : -1) * Math.PI * 0.9 * ease(p);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - p;
        ctx.lineCap = 'round';
        ctx.shadowColor = e.color; ctx.shadowBlur = 12;
        for (let k = 0; k < 3; k++) {
          ctx.lineWidth = Math.max(1, S * (0.09 - k * 0.025));
          ctx.beginPath();
          ctx.arc(X(e.x), Y(e.y), r - k * S * 0.08, a0, a0 + sweep, e.flip ? false : true);
          ctx.stroke();
        }
        break;
      }
      case 'arrow': {
        const q = ease(p);
        const x = e.from.x + (e.to.x - e.from.x) * q, y = e.from.y + (e.to.y - e.from.y) * q;
        const ang = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x);
        ctx.translate(X(x), Y(y));
        ctx.rotate(ang);
        ctx.strokeStyle = '#e8d6b0'; ctx.lineWidth = Math.max(1.5, S * 0.05);
        ctx.beginPath(); ctx.moveTo(-S * 0.4, 0); ctx.lineTo(S * 0.15, 0); ctx.stroke();
        ctx.fillStyle = '#ddd';
        ctx.beginPath(); ctx.moveTo(S * 0.25, 0); ctx.lineTo(S * 0.1, -S * 0.08); ctx.lineTo(S * 0.1, S * 0.08); ctx.fill();
        ctx.fillStyle = e.color === '#f2f2f2' || e.color === '#e6e6e6' ? '#c0392b' : e.color;
        ctx.fillRect(-S * 0.42, -S * 0.06, S * 0.1, S * 0.12);
        break;
      }
      case 'orb': {
        const q = ease(p);
        const x = e.from.x + (e.to.x - e.from.x) * q, y = e.from.y + (e.to.y - e.from.y) * q;
        for (let k = 5; k >= 0; k--) {
          const tq = Math.max(0, q - k * 0.04);
          const tx = e.from.x + (e.to.x - e.from.x) * tq, ty = e.from.y + (e.to.y - e.from.y) * tq;
          ctx.globalAlpha = 0.15 + (1 - k / 6) * 0.5;
          ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(X(tx), Y(ty), S * (0.06 + (6 - k) * 0.02), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowColor = e.color; ctx.shadowBlur = 18;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(X(x), Y(y), S * 0.1, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'area': {
        // Each cell flares as the wave reaches it (55 ms per cell of distance)
        const elapsed = t - e.start;
        for (const [c, r, d] of e.cells) {
          const q = (elapsed - d * 55) / 520;
          if (q < 0 || q > 1) continue;
          ctx.fillStyle = hexA(e.color, 0.6 * (1 - q));
          ctx.fillRect(X(c), Y(r), S, S);
          if (q < 0.35) { ctx.fillStyle = 'rgba(255,255,255,' + (0.45 * (1 - q / 0.35)) + ')'; ctx.fillRect(X(c) + S * 0.2, Y(r) + S * 0.2, S * 0.6, S * 0.6); }
        }
        break;
      }
      case 'blast': {
        const q = ease(p);
        const rr = e.r * S * (0.3 + 0.7 * q);
        const g = ctx.createRadialGradient(X(e.x), Y(e.y), 0, X(e.x), Y(e.y), rr);
        g.addColorStop(0, 'rgba(255,255,255,' + (0.7 * (1 - p)) + ')');
        g.addColorStop(0.4, hexA(e.color, 0.55 * (1 - p)));
        g.addColorStop(1, hexA(e.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), rr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = hexA(e.color, 1 - p);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), rr, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'heal': {
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = '#7dffb0';
        for (let k = 0; k < 7; k++) {
          const ang = k / 7 * Math.PI * 2 + p * 2;
          const px = e.x + Math.cos(ang) * 0.35, py = e.y + 0.3 - p * 0.9 - (k % 3) * 0.1;
          const sz = S * 0.07;
          ctx.fillRect(X(px) - sz / 2, Y(py) - sz * 1.5, sz, sz * 3);
          ctx.fillRect(X(px) - sz * 1.5, Y(py) - sz / 2, sz * 3, sz);
        }
        const g = ctx.createRadialGradient(X(e.x), Y(e.y), 0, X(e.x), Y(e.y), S * 0.7);
        g.addColorStop(0, 'rgba(120,255,170,' + 0.35 * (1 - p) + ')');
        g.addColorStop(1, 'rgba(120,255,170,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), S * 0.7, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'text': {
        const rise = ease(Math.min(1, p * 1.4)) * 0.8;
        const sc = e.big ? 1 + Math.max(0, 0.6 - p * 3) : 1;
        ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
        ctx.font = `800 ${Math.max(12, S * (e.big ? 0.42 : 0.34) * sc)}px "Fira Sans", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(e.text, X(e.x), Y(e.y - 0.3 - rise));
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, X(e.x), Y(e.y - 0.3 - rise));
        break;
      }
      case 'flash':
        ctx.fillStyle = `rgba(255,240,200,${0.25 * (1 - p)})`;
        ctx.fillRect(0, 0, W, H);
        break;
      case 'ping':
        for (let k = 0; k < 3; k++) {
          const q = (p * 1.5 + k * 0.25) % 1;
          ctx.strokeStyle = hexA(e.color, 1 - q);
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), S * (0.2 + q * 1.3), 0, Math.PI * 2); ctx.stroke();
        }
        break;
    }
    ctx.restore();
  }

  sparks = sparks.filter(sp => t - sp.start < sp.dur);
  for (const sp of sparks) {
    const p = (t - sp.start) / sp.dur;
    if (p < 0) continue;
    const q = ease(p);
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(X(sp.x + sp.vx * q * 0.6), Y(sp.y + sp.vy * q * 0.6), Math.max(1, S * 0.045 * (1 - p)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
