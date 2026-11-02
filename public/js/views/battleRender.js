// ============================================================
// Battle map rendering — terrain, background image, overlays,
// tokens and FX. drawScene() is pure drawing so it can also be
// pointed at an offscreen canvas for PNG export.
// ============================================================

import { tokenDef } from '../constants.js';
import { drawTerrain } from './terrainArt.js';
import { tokenView, healthFraction } from '../core/ops.js';
import { fileUrl, avatarOf } from '../store.js';
import * as fx from './fx.js';

const images = new Map();

// Loads (and caches) an image; calls onLoad once ready
export function getImage(src, onLoad) {
  if (!src) return null;
  let rec = images.get(src);
  if (!rec) {
    const img = new Image();
    rec = { img, ok: false };
    images.set(src, rec);
    img.onload = () => { rec.ok = true; onLoad?.(); };
    img.onerror = () => { rec.failed = true; };
    img.src = src;
  }
  return rec.ok ? rec.img : null;
}

export function colLabel(col) {
  let lbl = '';
  let n = col;
  do {
    lbl = String.fromCharCode(65 + (n % 26)) + lbl;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return lbl;
}

// view: { state, cam:{x,y,s}, isDM, overlays, settings:{grid, coords}, onImage }
// Returns { animated } — true when animated tiles (fire, water…) are on screen
export function drawScene(ctx, W, H, view) {
  const { state, cam } = view;
  const map = state.map;
  const s = cam.s;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#07070e';
  ctx.fillRect(0, 0, W, H);

  const sc = Math.max(0, Math.floor(-cam.x / s));
  const ec = Math.min(map.width, Math.ceil((W - cam.x) / s));
  const sr = Math.max(0, Math.floor(-cam.y / s));
  const er = Math.min(map.height, Math.ceil((H - cam.y) / s));

  // Background image
  if (map.bg?.fileId) {
    const img = getImage(fileUrl(map.bg.fileId), view.onImage);
    ctx.fillStyle = '#111';
    ctx.fillRect(cam.x, cam.y, map.width * s, map.height * s);
    if (img) {
      const w = map.width * s * (map.bg.scale || 1);
      const h = w * (img.naturalHeight / img.naturalWidth);
      ctx.globalAlpha = map.bg.opacity ?? 1;
      ctx.drawImage(img, cam.x + (map.bg.ox || 0) * s, cam.y + (map.bg.oy || 0) * s, w, h);
      ctx.globalAlpha = 1;
    }
  }

  // The live view passes mapRev so the static ground can be cached between frames
  const cacheKey = view.mapRev == null ? null : `${view.mapRev}|${cam.x}|${cam.y}|${cam.s}|${W}|${H}`;
  const animated = drawTerrain(ctx, map, cam, { sc, ec, sr, er }, { cacheKey, W, H });

  // Grid
  if (view.settings.grid !== false) {
    ctx.strokeStyle = `rgba(255,255,255,${view.settings.gridAlpha ?? 0.14})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = sc; c <= ec; c++) {
      const x = Math.round(c * s + cam.x) + 0.5;
      ctx.moveTo(x, sr * s + cam.y);
      ctx.lineTo(x, er * s + cam.y);
    }
    for (let r = sr; r <= er; r++) {
      const y = Math.round(r * s + cam.y) + 0.5;
      ctx.moveTo(sc * s + cam.x, y);
      ctx.lineTo(ec * s + cam.x, y);
    }
    ctx.stroke();
  }

  if (view.settings.coords && s >= 26) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = `${Math.max(8, Math.min(11, s * 0.2))}px "Fira Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = sr; r < er; r++) {
      for (let c = sc; c < ec; c++) ctx.fillText(`${colLabel(c)}${r + 1}`, c * s + cam.x + s / 2, r * s + cam.y + s * 0.88);
    }
  }

  const ov = view.overlays || {};
  drawOverlays(ctx, view, ov);

  // Tokens — dead under the living, selected on top
  const toks = Object.values(state.battle.tokens)
    .filter(t => view.isDM || !t.hidden)
    .map(t => tokenView(state, t))
    .sort((a, b) => (b.conditions.includes('dead') - a.conditions.includes('dead')) || ((a.id === ov.selectedId) - (b.id === ov.selectedId)));
  for (const t of toks) drawToken(ctx, t, view, ov);

  if (ov.pathEnd) drawPathLabel(ctx, view, ov);
  fx.draw(ctx, cam, W, H);
  return { animated };
}

// ------------------------------------------------------------
// Overlays: reachable cells, path, ranges, AoE preview
// ------------------------------------------------------------

function drawOverlays(ctx, view, ov) {
  const { cam } = view;
  const s = cam.s;

  if (ov.reach) {
    ctx.fillStyle = 'rgba(80,170,255,0.13)';
    for (const k of ov.reach.keys()) {
      const c = k % 10000, r = Math.floor(k / 10000);
      ctx.fillRect(c * s + cam.x + 1, r * s + cam.y + 1, s - 2, s - 2);
    }
  }

  if (ov.path?.length > 1) {
    const ok = ov.pathOk !== false;
    ctx.strokeStyle = ok ? 'rgba(120,200,255,0.9)' : 'rgba(255,90,90,0.9)';
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.setLineDash([s * 0.18, s * 0.12]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ov.path.forEach(([c, r], i) => {
      const x = (c + 0.5) * s + cam.x, y = (r + 0.5) * s + cam.y;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const [ec, er] = ov.path[ov.path.length - 1];
    ctx.strokeStyle = ok ? '#78c8ff' : '#ff5a5a';
    ctx.lineWidth = 2;
    ctx.strokeRect(ec * s + cam.x + 2, er * s + cam.y + 2, s - 4, s - 4);
  }

  if (ov.range) {
    const { x, y, r } = ov.range;
    ctx.strokeStyle = 'rgba(245,166,35,0.75)';
    ctx.fillStyle = 'rgba(245,166,35,0.06)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    // Chebyshev range = square on the grid
    ctx.rect((x - r) * s + cam.x, (y - r) * s + cam.y, r * 2 * s, r * 2 * s);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (ov.los) {
    const { from, to, level } = ov.los;
    const col = { none: 'rgba(120,220,140,0.85)', half: 'rgba(241,196,15,0.9)', three: 'rgba(230,126,34,0.9)', total: 'rgba(231,76,60,0.9)' }[level];
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(from[0] * s + cam.x, from[1] * s + cam.y);
    ctx.lineTo(to[0] * s + cam.x, to[1] * s + cam.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (ov.aoe) {
    const { x, y, r, ok } = ov.aoe;
    const col = ok ? '255,120,40' : '200,60,60';
    const g = ctx.createRadialGradient(x * s + cam.x, y * s + cam.y, 0, x * s + cam.x, y * s + cam.y, r * s);
    g.addColorStop(0, `rgba(${col},0.08)`);
    g.addColorStop(1, `rgba(${col},0.32)`);
    ctx.fillStyle = g;
    ctx.strokeStyle = `rgba(${col},0.95)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x * s + cam.x, y * s + cam.y, r * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawPathLabel(ctx, view, ov) {
  const { cam } = view;
  const s = cam.s;
  const [c, r] = ov.pathEnd;
  const x = (c + 0.5) * s + cam.x, y = r * s + cam.y - 6;
  const txt = ov.pathLabel;
  ctx.font = '600 12px "Fira Sans", sans-serif';
  const w = ctx.measureText(txt).width + 12;
  ctx.fillStyle = 'rgba(10,14,30,0.9)';
  ctx.strokeStyle = ov.pathOk === false ? '#ff5a5a' : '#78c8ff';
  ctx.lineWidth = 1;
  roundRect(ctx, x - w / 2, y - 20, w, 18, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y - 11);
}

// ------------------------------------------------------------
// Tokens
// ------------------------------------------------------------

const SIDE_RING = { party: '#6ab4f5', enemy: '#f06262', neutral: '#7ddc8a' };

function drawToken(ctx, t, view, ov) {
  const { cam } = view;
  const s = cam.s;
  const size = t.size || 1;
  const pos = fx.tokenOffset(t);
  const px = pos.col * s + cam.x, py = pos.row * s + cam.y;
  const span = s * size;
  const tcx = px + span / 2, tcy = py + span / 2;
  const rad = span * 0.41;
  const def = tokenDef(t.type);
  const dead = t.conditions.includes('dead');
  const down = t.conditions.includes('unconscious');
  const now = performance.now();

  ctx.save();
  if (t.hidden) ctx.globalAlpha = 0.45;
  if (dead) ctx.globalAlpha *= 0.55;

  // Current turn: pulsing halo
  if (ov.turnId === t.id) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 250);
    ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.1 * pulse})`;
    ctx.beginPath(); ctx.arc(tcx, tcy, rad + 7 + pulse * 3, 0, Math.PI * 2); ctx.fill();
  }

  // Selection / targeting rings
  if (ov.selectedId === t.id) {
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#f5a623'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(tcx, tcy, rad + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  const targetCount = ov.targets?.filter(id => id === t.id).length || 0;
  if (targetCount || ov.hoverTargetId === t.id) {
    drawCrosshair(ctx, tcx, tcy, rad + 6, targetCount ? '#ff4040' : 'rgba(255,90,90,0.7)', now);
    if (targetCount > 1) {
      ctx.fillStyle = '#ff4040';
      ctx.font = `700 ${Math.max(10, s * 0.25)}px "Fira Sans"`;
      ctx.textAlign = 'center';
      ctx.fillText('×' + targetCount, tcx + rad, tcy - rad);
    }
  }

  const cover = ov.cover?.get(t.id);

  // Body
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 7;
  ctx.fillStyle = dead ? '#3a3a3a' : (t.color || def.color);
  ctx.beginPath(); ctx.arc(tcx, tcy, rad, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  const src = avatarOf(t);
  const img = src ? getImage(src, view.onImage) : null;
  if (img && !dead) {
    ctx.save();
    ctx.beginPath(); ctx.arc(tcx, tcy, rad - 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, tcx - rad, tcy - rad, rad * 2, rad * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.arc(tcx - rad * 0.2, tcy - rad * 0.25, rad * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, span * 0.27)}px "Fira Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dead ? '☠' : (t.abbr || initials(t.name) || def.abbr), tcx, tcy + 1);
  }

  ctx.strokeStyle = SIDE_RING[t.side || (t.isPC ? 'party' : 'enemy')] || '#ccc';
  ctx.lineWidth = 2;
  if (t.hidden) ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.arc(tcx, tcy, rad, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  if (down && !dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(tcx, tcy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(9, span * 0.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('💤', tcx, tcy);
  }

  // Name
  if (t.name && s >= 30) {
    ctx.font = `600 ${Math.max(9, Math.min(13, s * 0.22))}px "Fira Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const name = t.name.length > 14 ? t.name.slice(0, 13) + '…' : t.name;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(name, tcx, py + span - 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(name, tcx, py + span - 2);
  }

  // HP bar
  if ((t.maxHp > 0 || t.redacted) && s >= 22 && !dead) {
    const bw = span * 0.74, bh = Math.max(4, s * 0.09);
    const bx = tcx - bw / 2, by = py + 1;
    const pct = healthFraction(t);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 2);
    ctx.fill();
    ctx.fillStyle = pct > 0.6 ? '#2ecc71' : pct > 0.3 ? '#e67e22' : '#e74c3c';
    ctx.fillRect(bx, by, bw * pct, bh);
    if (t.tempHp > 0 && t.maxHp) {
      ctx.fillStyle = 'rgba(120,180,255,0.9)';
      ctx.fillRect(bx, by + bh - 2, Math.min(bw, bw * t.tempHp / t.maxHp), 2);
    }
  }

  if (cover && cover !== 'none') drawCoverBadge(ctx, px + span * 0.12, py + span * 0.22, cover, s);

  // Condition pips
  const conds = t.conditions.filter(c => c !== 'dead' && c !== 'unconscious');
  if (conds.length && s >= 26) {
    conds.slice(0, 4).forEach((c, i) => {
      ctx.fillStyle = CONDITION_COLORS[c] || '#bbb';
      ctx.beginPath();
      ctx.arc(px + span - 5 - i * 7, py + span * 0.28, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

const CONDITION_COLORS = {
  poisoned: '#5fd35f', frightened: '#b05cff', charmed: '#ff7ab8', prone: '#c49a6c', stunned: '#ffe94d',
  paralyzed: '#ffe94d', restrained: '#c49a6c', grappled: '#c49a6c', blinded: '#888', invisible: '#ddd',
  concentrating: '#7fd7ff', blessed: '#ffe9a6', hasted: '#7fffd4', raging: '#ff5a4f',
};

const COVER_BADGE = { half: ['#f1c40f', '½'], three: ['#e67e22', '¾'], total: ['#e74c3c', '✕'] };

// Small shield next to a token while aiming, showing the cover it has from the attacker
function drawCoverBadge(ctx, x, y, level, s) {
  const [color, txt] = COVER_BADGE[level];
  const w = Math.max(11, s * 0.28), hh = w * 1.15;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - hh / 2);
  ctx.lineTo(x + w / 2, y - hh / 2);
  ctx.lineTo(x + w / 2, y);
  ctx.quadraticCurveTo(x + w / 2, y + hh * 0.35, x, y + hh / 2);
  ctx.quadraticCurveTo(x - w / 2, y + hh * 0.35, x - w / 2, y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,14,30,0.92)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `800 ${w * 0.62}px "Fira Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y - hh * 0.04);
  ctx.restore();
}

function drawCrosshair(ctx, x, y, r, color, now) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(now / 1200);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, 0, r, -0.45, 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r - 4, 0); ctx.lineTo(r + 5, 0);
    ctx.stroke();
  }
  ctx.restore();
}

function initials(name) {
  if (!name) return '';
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!w.length) return name.slice(0, 2);
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
