// ============================================================
// Hexcrawl view — paint terrain/icons/labels on a hex grid (or
// align a grid over an uploaded map image), fog of war, and
// party travel that feeds the adventure log.
// ============================================================

import { store, subscribe, dispatch, isDM, canEdit, fileUrl } from '../store.js';
import { hexKey, parseHexKey, hexCenter, hexCorners, pixelToHex, hexDistance } from '../core/hexmath.js';
import { HEX_TERRAINS, HEX_ICONS } from '../constants.js';
import { h, toast, openModal, confirmDialog, promptDialog, field, pickFile, timeAgo } from '../ui/dom.js';
import { uploadImage } from '../net.js';
import { getImage } from './battleRender.js';
import { escapeHtml } from '../core/util.js';

const ui = {
  cam: { x: 40, y: 40 }, zoom: 1,
  tool: { mode: 'inspect' },  // inspect | terrain | icon | label | erase | reveal | hide | party
  selected: null,             // hex key
  hover: null,                // [c, r]
  drag: null,
  panel: null,
  visible: false,
};
let canvas, ctx, wrap, tip, sideEl;
let dirty = true;
let centered = false;
let hasFog = false;
let buffer = [];
let flushT = null;

const hexLabel = (c, r) => String(c + 1).padStart(2, '0') + String(r + 1).padStart(2, '0');

export function mountHex(root) {
  canvas = h('canvas', { class: 'battle-canvas' });
  ctx = canvas.getContext('2d');
  tip = h('div', { class: 'map-tip' });
  wrap = h('div', { class: 'battle-stage hex-stage' }, canvas, tip);
  sideEl = h('aside', { class: 'side-panel' });
  root.append(h('div', { class: 'battle-layout' }, wrap, sideEl));
  new ResizeObserver(resize).observe(wrap);
  bindInput();

  subscribe(changed => {
    if (!store.state) return;
    if (changed.has('*') || changed.has('hex') || changed.has('adventure') || changed.has('meta')) {
      if (changed.has('*') && !centered) { fitView(); centered = true; }
      buildSide();
      dirty = true;
    }
  });
  requestAnimationFrame(loop);
}

export function showHex(v) {
  ui.visible = v;
  if (v) { resize(); buildSide(); }
}

let lastFogFrame = 0;

function loop(t) {
  // Fog drifts, so redraw ~20 fps while any fog is on screen
  if (hasFog && t - lastFogFrame > 50) { dirty = true; lastFogFrame = t; }
  if (ui.visible && store.state && dirty) { dirty = false; draw(); }
  requestAnimationFrame(loop);
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, hh = wrap.clientHeight;
  if (!w || !hh) return;
  canvas.width = w * dpr; canvas.height = hh * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!centered && store.state) { fitView(); centered = true; }
  dirty = true;
}

function mapExtent() {
  const hx = store.state.hex;
  const last = hexCenter(hx.cols - 1, hx.rows - 1, hx.size, hx.orientation);
  let w = last.x + hx.size * 1.2 + hx.offsetX, hh = last.y + hx.size * 1.2 + hx.offsetY;
  if (hx.bg) { w = Math.max(w, hx.bg.w * (hx.bg.scale || 1)); hh = Math.max(hh, hx.bg.h * (hx.bg.scale || 1)); }
  return { w, h: hh };
}

function fitView() {
  if (!wrap.clientWidth) return;
  const e = mapExtent();
  ui.zoom = Math.max(0.15, Math.min(2, Math.min((wrap.clientWidth - 40) / e.w, (wrap.clientHeight - 40) / e.h)));
  ui.cam.x = (wrap.clientWidth - e.w * ui.zoom) / 2;
  ui.cam.y = (wrap.clientHeight - e.h * ui.zoom) / 2;
  dirty = true;
}

const toScreen = (x, y) => [x * ui.zoom + ui.cam.x, y * ui.zoom + ui.cam.y];

function hexAt(mx, my) {
  const hx = store.state.hex;
  const x = (mx - ui.cam.x) / ui.zoom - hx.offsetX, y = (my - ui.cam.y) / ui.zoom - hx.offsetY;
  const [c, r] = pixelToHex(x, y, hx.size, hx.orientation);
  return c >= 0 && r >= 0 && c < hx.cols && r < hx.rows ? [c, r] : null;
}

// ------------------------------------------------------------
// Drawing
// ------------------------------------------------------------

function draw() {
  const hx = store.state.hex;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const dm = isDM();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0c16';
  ctx.fillRect(0, 0, W, H);

  if (hx.bg?.fileId) {
    const img = getImage(fileUrl(hx.bg.fileId), () => { dirty = true; });
    if (img) {
      const [x, y] = toScreen(0, 0);
      ctx.globalAlpha = hx.bg.opacity ?? 1;
      ctx.drawImage(img, x, y, hx.bg.w * (hx.bg.scale || 1) * ui.zoom, hx.bg.h * (hx.bg.scale || 1) * ui.zoom);
      ctx.globalAlpha = 1;
    }
  }

  const size = hx.size * ui.zoom;
  const party = hx.party;
  const overlays = [];
  const fogHexes = [];
  for (let r = 0; r < hx.rows; r++) {
    for (let c = 0; c < hx.cols; c++) {
      const k = hexKey(c, r);
      const data = hx.hexes[k] || {};
      const cen = hexCenter(c, r, hx.size, hx.orientation);
      const [sx, sy] = toScreen(cen.x + hx.offsetX, cen.y + hx.offsetY);
      if (sx < -size * 2 || sy < -size * 2 || sx > W + size * 2 || sy > H + size * 2) continue;
      const pts = hexCorners(sx, sy, size, hx.orientation);
      const fogged = hx.fog && !data.revealed;

      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();

      if (fogged && !dm) {
        // Slightly oversized so neighbouring fog hexes leave no seams
        ctx.fillStyle = '#5d6577';
        ctx.beginPath();
        hexCorners(sx, sy, size + 1, hx.orientation).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        fogHexes.push([c, r, sx, sy]);
        continue;
      }

      if (data.terrain && HEX_TERRAINS[data.terrain]) {
        ctx.globalAlpha = hx.bg ? (hx.terrainAlpha ?? 0.5) : 1;
        ctx.fillStyle = HEX_TERRAINS[data.terrain].color;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (size > 14 && (!hx.bg || (hx.terrainAlpha ?? 0.5) > 0.3)) drawGlyph(data.terrain, sx, sy, size);
      } else if (!hx.bg) {
        ctx.fillStyle = '#1a2033';
        ctx.fill();
      }
      ctx.strokeStyle = hx.bg ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();

      if (data.icon || data.label || (dm && (data.note || data.dmNote))) overlays.push({ sx, sy, data, fogged });
      if (fogged && dm) {
        ctx.fillStyle = 'rgba(120,130,150,0.35)';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        fogHexes.push([c, r, sx, sy]);
      }
    }
  }

  hasFog = ui.visible && fogHexes.length > 0;
  drawFog(fogHexes, size, dm);

  for (const { sx, sy, data, fogged } of overlays) {
    ctx.globalAlpha = fogged ? 0.5 : 1;
    if (data.icon && HEX_ICONS[data.icon] && size > 10) {
      ctx.font = `${size * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(HEX_ICONS[data.icon], sx, sy - (data.label ? size * 0.12 : 0));
    }
    if (data.label && size > 16) {
      ctx.font = `600 ${Math.max(9, Math.min(14, size * 0.28))}px Cinzel, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(data.label, sx, sy + size * 0.55);
      ctx.fillStyle = '#f3e3b3';
      ctx.fillText(data.label, sx, sy + size * 0.55);
    }
    if (dm && (data.note || data.dmNote) && size > 14) {
      ctx.fillStyle = data.dmNote ? '#e94560' : '#f5a623';
      ctx.beginPath(); ctx.arc(sx + size * 0.55, sy - size * 0.5, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Hover / selection / travel preview
  const outline = ([c, r], color, width) => {
    const cen = hexCenter(c, r, hx.size, hx.orientation);
    const [sx, sy] = toScreen(cen.x + hx.offsetX, cen.y + hx.offsetY);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    hexCorners(sx, sy, size - 1, hx.orientation).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    return [sx, sy];
  };
  if (ui.selected) outline(parseHexKey(ui.selected), '#f5a623', 3);
  if (ui.hover) outline(ui.hover, 'rgba(255,255,255,0.6)', 2);

  if (party) {
    const cen = hexCenter(party[0], party[1], hx.size, hx.orientation);
    const [sx, sy] = toScreen(cen.x + hx.offsetX, cen.y + hx.offsetY);
    if (ui.tool.mode === 'party' && ui.hover) {
      const hc = hexCenter(ui.hover[0], ui.hover[1], hx.size, hx.orientation);
      const [tx, ty] = toScreen(hc.x + hx.offsetX, hc.y + hx.offsetY);
      ctx.strokeStyle = 'rgba(245,166,35,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
    const rad = Math.max(8, size * 0.42);
    ctx.shadowColor = '#f5a623';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = `${rad * 1.1}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛡️', sx, sy + 1);
  }
}

// ------------------------------------------------------------
// Fog of war — soft drifting cloud puffs that spill past hex edges
// ------------------------------------------------------------

let puffSprite = null;

function getPuff() {
  if (puffSprite) return puffSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(200,207,220,1)');
  grad.addColorStop(0.35, 'rgba(184,192,208,0.7)');
  grad.addColorStop(0.7, 'rgba(160,168,186,0.25)');
  grad.addColorStop(1, 'rgba(150,158,176,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  puffSprite = c;
  return c;
}

// Deterministic per-hex randomness so the fog doesn't flicker between frames
function hash(c, r, i) {
  const n = Math.sin(c * 127.1 + r * 311.7 + i * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function drawFog(hexes, size, dm) {
  if (!hexes.length) return;
  const puff = getPuff();
  const t = performance.now() / 1000;
  ctx.save();
  // Two layers: a dense low bank, then lighter wisps drifting the other way
  for (const [layer, count, alpha, scale, speed] of [[0, 3, dm ? 0.22 : 0.42, 1.5, 0.12], [1, 3, dm ? 0.14 : 0.28, 1.1, -0.2]]) {
    for (const [c, r, sx, sy] of hexes) {
      for (let i = 0; i < count; i++) {
        const k = layer * 10 + i;
        const phase = hash(c, r, k) * Math.PI * 2;
        const ox = (hash(c, r, k + 1) - 0.5) * size * 1.1 + Math.sin(t * speed + phase) * size * 0.25;
        const oy = (hash(c, r, k + 2) - 0.5) * size * 0.9 + Math.cos(t * speed * 0.7 + phase) * size * 0.15;
        const rad = size * scale * (0.75 + hash(c, r, k + 3) * 0.6);
        ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(t * 0.4 + phase));
        ctx.drawImage(puff, sx + ox - rad, sy + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  ctx.restore();
}

function drawGlyph(t, x, y, s) {
  ctx.save();
  ctx.lineWidth = Math.max(1, s * 0.04);
  const tri = (cx, cy, w, hh, fill, cap) => {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + w, cy); ctx.lineTo(cx - w, cy); ctx.closePath(); ctx.fill();
    if (cap) {
      ctx.fillStyle = cap;
      ctx.beginPath(); ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + w * 0.35, cy - hh * 0.65); ctx.lineTo(cx - w * 0.35, cy - hh * 0.65); ctx.closePath(); ctx.fill();
    }
  };
  switch (t) {
    case 'forest':
    case 'jungle': {
      const n = t === 'jungle' ? [[-0.35, 0.1], [0.35, 0.1], [0, -0.15], [-0.15, 0.4], [0.2, 0.4]] : [[-0.3, 0.15], [0.3, 0.15], [0, -0.1]];
      for (const [dx, dy] of n) {
        ctx.fillStyle = '#4a2f1a';
        ctx.fillRect(x + dx * s - s * 0.02, y + dy * s, s * 0.04, s * 0.1);
        tri(x + dx * s, y + dy * s + s * 0.02, s * 0.14, s * 0.32, t === 'jungle' ? '#174d22' : '#1d4f28');
      }
      break;
    }
    case 'mountains':
      tri(x - s * 0.2, y + s * 0.3, s * 0.3, s * 0.6, '#5b554d', '#e8e8e8');
      tri(x + s * 0.22, y + s * 0.32, s * 0.24, s * 0.45, '#666059', '#e8e8e8');
      break;
    case 'hills':
      ctx.strokeStyle = '#6e6238';
      for (const [dx, dy] of [[-0.25, 0.15], [0.2, 0.05], [0, 0.35]]) {
        ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s + s * 0.1, s * 0.18, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
      break;
    case 'swamp':
      ctx.strokeStyle = '#2c3a22';
      for (const [dx, dy] of [[-0.3, 0.1], [0.25, 0.0], [0, 0.35]]) {
        const bx = x + dx * s, by = y + dy * s;
        ctx.beginPath();
        ctx.moveTo(bx - s * 0.12, by); ctx.lineTo(bx + s * 0.12, by);
        ctx.moveTo(bx, by); ctx.lineTo(bx, by - s * 0.14);
        ctx.moveTo(bx - s * 0.06, by); ctx.lineTo(bx - s * 0.1, by - s * 0.1);
        ctx.moveTo(bx + s * 0.06, by); ctx.lineTo(bx + s * 0.1, by - s * 0.1);
        ctx.stroke();
      }
      break;
    case 'water':
    case 'deep':
      ctx.strokeStyle = t === 'deep' ? 'rgba(120,170,230,0.45)' : 'rgba(160,210,255,0.55)';
      for (const dy of [-0.2, 0.1, 0.4]) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.35, y + dy * s);
        ctx.quadraticCurveTo(x - s * 0.17, y + dy * s - s * 0.1, x, y + dy * s);
        ctx.quadraticCurveTo(x + s * 0.17, y + dy * s + s * 0.1, x + s * 0.35, y + dy * s);
        ctx.stroke();
      }
      break;
    case 'desert':
      ctx.strokeStyle = '#b8954e';
      for (const [dx, dy] of [[-0.2, 0.0], [0.2, 0.3]]) {
        ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s + s * 0.2, s * 0.22, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      }
      break;
    case 'tundra':
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.7) * s * 0.35, y + Math.sin(i * 2.3) * s * 0.35, s * 0.03, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'plains':
    case 'grassland':
      ctx.strokeStyle = t === 'plains' ? '#5d7a35' : '#6d9140';
      for (const [dx, dy] of [[-0.3, 0.2], [0.25, 0.25], [0, -0.1], [-0.1, 0.45]]) {
        const bx = x + dx * s, by = y + dy * s;
        ctx.beginPath();
        ctx.moveTo(bx, by); ctx.lineTo(bx - s * 0.04, by - s * 0.1);
        ctx.moveTo(bx, by); ctx.lineTo(bx + s * 0.04, by - s * 0.1);
        ctx.stroke();
      }
      break;
    case 'farmland':
      ctx.strokeStyle = '#8f7f35';
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x - s * 0.4, y + i * s * 0.14); ctx.lineTo(x + s * 0.4, y + i * s * 0.14); ctx.stroke(); }
      break;
    case 'badlands':
      ctx.strokeStyle = '#6e3a22';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.4, y); ctx.lineTo(x - s * 0.1, y + s * 0.1); ctx.lineTo(x + s * 0.05, y - s * 0.15); ctx.lineTo(x + s * 0.35, y + s * 0.05);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

// ------------------------------------------------------------
// Input
// ------------------------------------------------------------

function flush() {
  if (buffer.length) dispatch({ type: 'hex.paint', hexes: buffer });
  buffer = [];
  flushT = null;
}

function paintHex([c, r], erase) {
  const k = hexKey(c, r);
  const cur = store.state.hex.hexes[k] || {};
  const t = ui.tool;
  let patch = null;
  if (t.mode === 'terrain') patch = erase ? { terrain: null } : { terrain: t.value };
  else if (t.mode === 'icon') patch = erase ? { icon: null } : { icon: t.value };
  else if (t.mode === 'erase') patch = { terrain: null, icon: null, label: null };
  else if (t.mode === 'reveal') patch = { revealed: erase ? null : true };
  else if (t.mode === 'hide') patch = { revealed: null };
  if (!patch) return;
  if (Object.entries(patch).every(([pk, pv]) => (cur[pk] ?? null) === pv)) return;
  // Optimistic local paint; the op re-applies idempotently
  const next = { ...cur };
  for (const [pk, pv] of Object.entries(patch)) { if (pv === null) delete next[pk]; else next[pk] = pv; }
  store.state.hex.hexes[k] = next;
  buffer.push({ k, patch });
  if (!flushT) flushT = setTimeout(flush, 150);
  dirty = true;
}

function bindInput() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', async e => {
    if (!store.state) return;
    const rect = canvas.getBoundingClientRect();
    const hx = hexAt(e.clientX - rect.left, e.clientY - rect.top);
    const editor = canEdit();
    const brush = ['terrain', 'icon', 'erase', 'reveal', 'hide'].includes(ui.tool.mode);

    if (e.button === 1 || e.button === 2 && !(brush && editor) || (e.button === 0 && !hx)) {
      ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y };
      return;
    }
    if (!hx) return;
    if (brush && editor) {
      ui.drag = { kind: 'paint', erase: e.button === 2 };
      paintHex(hx, e.button === 2);
      return;
    }
    if (ui.tool.mode === 'label' && editor && e.button === 0) {
      const k = hexKey(...hx);
      const val = await promptDialog('Hex label', 'Label (blank to remove)', store.state.hex.hexes[k]?.label || '');
      if (val !== null) dispatch({ type: 'hex.paint', hexes: [{ k, patch: { label: val.trim().slice(0, 40) || null } }] });
      return;
    }
    if (ui.tool.mode === 'party' && isDM() && e.button === 0) {
      const from = store.state.hex.party;
      const t = store.state.hex.hexes[hexKey(...hx)]?.terrain;
      dispatch({ type: 'hex.moveParty', to: hx, dist: from ? hexDistance(from, hx, store.state.hex.orientation) : 0, terrainLabel: HEX_TERRAINS[t]?.label?.toLowerCase() });
      return;
    }
    ui.selected = hexKey(...hx);
    ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y };
    buildSide();
    dirty = true;
  });

  window.addEventListener('mousemove', e => {
    if (!ui.visible || !store.state) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (ui.drag?.kind === 'pan') {
      ui.cam.x = ui.drag.cx + e.clientX - ui.drag.sx;
      ui.cam.y = ui.drag.cy + e.clientY - ui.drag.sy;
      dirty = true;
      return;
    }
    const inside = mx >= 0 && my >= 0 && mx <= rect.width && my <= rect.height;
    const hx = inside ? hexAt(mx, my) : null;
    if (String(hx) !== String(ui.hover)) {
      ui.hover = hx;
      dirty = true;
      if (ui.drag?.kind === 'paint' && hx) paintHex(hx, ui.drag.erase);
    }
    updateTip(mx, my, hx);
  });

  window.addEventListener('mouseup', () => {
    if (ui.drag?.kind === 'paint') flush();
    ui.drag = null;
  });

  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const old = ui.zoom;
    ui.zoom = Math.max(0.1, Math.min(5, ui.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    const k = ui.zoom / old;
    ui.cam.x = mx - k * (mx - ui.cam.x);
    ui.cam.y = my - k * (my - ui.cam.y);
    dirty = true;
  }, { passive: false });

  document.addEventListener('keydown', e => {
    if (!ui.visible || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { ui.tool = { mode: 'inspect' }; ui.selected = null; buildSide(); dirty = true; }
  });
}

function updateTip(x, y, hx) {
  if (!hx) { tip.style.display = 'none'; return; }
  const s = store.state.hex;
  const d = s.hexes[hexKey(...hx)] || {};
  const fogged = s.fog && !d.revealed && !isDM();
  let html = `<b>Hex ${hexLabel(...hx)}</b>`;
  if (!fogged) {
    if (d.label) html += ` — ${escapeHtml(d.label)}`;
    if (d.terrain) html += `<br>${HEX_TERRAINS[d.terrain]?.label || d.terrain}`;
  } else html += '<br><i>Unexplored</i>';
  if (s.party && (ui.tool.mode === 'party' || !fogged)) {
    const dist = hexDistance(s.party, hx, s.orientation);
    if (dist) html += `<br><small>${dist} hex · ${dist * (s.milesPerHex || 6)} mi · ~${Math.max(1, Math.round(dist * (s.milesPerHex || 6) / 24 * 10) / 10)} days</small>`;
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(x + 16, wrap.clientWidth - 200) + 'px';
  tip.style.top = (y + 16) + 'px';
}

// ------------------------------------------------------------
// Side panel
// ------------------------------------------------------------

function buildSide() {
  if (!store.state || !sideEl) return;
  const editor = canEdit();
  if (!ui.panel || (ui.panel !== 'travel' && !editor)) ui.panel = editor ? 'paint' : 'travel';
  const keep = sideEl.querySelector('.side-body')?.scrollTop || 0;
  sideEl.innerHTML = '';
  const tabBtn = (k, l) => h('button', { class: 'side-tab' + (ui.panel === k ? ' active' : ''), onclick: () => { ui.panel = k; buildSide(); } }, l);
  const body = h('div', { class: 'side-body' });
  sideEl.append(h('div', { class: 'side-tabs' }, editor ? tabBtn('paint', 'Paint') : null, editor ? tabBtn('setup', 'Setup') : null, tabBtn('travel', 'Travel')), body);
  const parts = [...(ui.selected ? inspectPanel() : []), ...({ paint: paintPanel, setup: setupPanel, travel: travelPanel }[ui.panel]())];
  body.append(...parts.filter(Boolean));
  body.scrollTop = keep;
}

function setTool(t) { ui.tool = t; buildSide(); dirty = true; }

function paintPanel() {
  const t = ui.tool;
  const tb = (mode, label, icon, extra = {}) => h('button', {
    class: 'tool-btn' + (t.mode === mode && (extra.value === undefined || t.value === extra.value) ? ' selected' : ''),
    onclick: () => setTool(t.mode === mode && t.value === extra.value ? { mode: 'inspect' } : { mode, ...extra }),
  }, icon, h('span', {}, label));
  return [
    h('div', { class: 'grid-3' },
      tb('inspect', 'Inspect', h('div', { class: 'swatch icon' }, '🔍')),
      tb('label', 'Label', h('div', { class: 'swatch icon' }, '🏷')),
      tb('erase', 'Erase', h('div', { class: 'swatch icon' }, '🧽')),
      isDM() ? tb('reveal', 'Reveal', h('div', { class: 'swatch icon' }, '👁')) : null,
      isDM() ? tb('hide', 'Fog', h('div', { class: 'swatch icon' }, '🌫')) : null,
      isDM() ? tb('party', 'Move party', h('div', { class: 'swatch icon' }, '🛡️')) : null),
    h('div', { class: 'section-title' }, 'Terrain'),
    h('div', { class: 'grid-3' }, Object.entries(HEX_TERRAINS).map(([k, v]) => tb('terrain', v.label, h('div', { class: 'swatch hex', style: { background: v.color } }), { value: k }))),
    h('div', { class: 'section-title' }, 'Icons'),
    h('div', { class: 'grid-4' }, Object.entries(HEX_ICONS).map(([k, v]) => h('button', {
      class: 'icon-tool' + (t.mode === 'icon' && t.value === k ? ' selected' : ''), title: k,
      onclick: () => setTool(t.mode === 'icon' && t.value === k ? { mode: 'inspect' } : { mode: 'icon', value: k }),
    }, v))),
    h('p', { class: 'hint' }, 'Drag to paint · right-drag erases · click a hex with Inspect to add notes.'),
  ];
}

function setupPanel() {
  const hx = store.state.hex;
  const set = patch => dispatch({ type: 'hex.config', patch });
  const num = (label, key, attrs) => field(label, h('input', { type: 'number', value: hx[key], ...attrs, onchange: e => set({ [key]: +e.target.value }) }));
  const upload = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    toast('Uploading…');
    try {
      const { fileId, w, h: ih } = await uploadImage(file);
      set({ bg: { fileId, w, h: ih, opacity: 1, scale: 1 }, terrainAlpha: 0 });
      fitView();
      toast('Map image set — use Hex size and Offset to line up the grid');
    } catch (e) { toast(e.message, true); }
  };
  return [
    h('div', { class: 'section-title' }, 'Grid'),
    h('div', { class: 'row' }, num('Columns', 'cols', { min: 1, max: 120 }), num('Rows', 'rows', { min: 1, max: 120 })),
    field('Orientation', h('select', { onchange: e => set({ orientation: e.target.value }) },
      h('option', { value: 'flat', selected: hx.orientation === 'flat' }, 'Flat-top'),
      h('option', { value: 'pointy', selected: hx.orientation === 'pointy' }, 'Pointy-top'))),
    field('Hex size', h('input', { type: 'range', min: 10, max: 160, step: 0.5, value: hx.size, oninput: e => { hx.size = +e.target.value; dirty = true; }, onchange: e => set({ size: +e.target.value }) })),
    h('div', { class: 'row' },
      field('Offset X', h('input', { type: 'number', step: 1, value: hx.offsetX, onchange: e => set({ offsetX: +e.target.value }) })),
      field('Offset Y', h('input', { type: 'number', step: 1, value: hx.offsetY, onchange: e => set({ offsetY: +e.target.value }) }))),
    num('Miles per hex', 'milesPerHex', { min: 1, max: 100 }),
    h('div', { class: 'section-title' }, 'Map image'),
    hx.bg ? h('div', {},
      field('Image opacity', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: hx.bg.opacity ?? 1, onchange: e => set({ bg: { ...hx.bg, opacity: +e.target.value } }) })),
      field('Image scale', h('input', { type: 'range', min: 0.2, max: 3, step: 0.01, value: hx.bg.scale ?? 1, oninput: e => { hx.bg.scale = +e.target.value; dirty = true; }, onchange: e => set({ bg: { ...hx.bg, scale: +e.target.value } }) })),
      field('Painted terrain opacity', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: hx.terrainAlpha ?? 0.5, onchange: e => set({ terrainAlpha: +e.target.value }) })),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: upload }, 'Replace'), h('button', { class: 'btn danger', onclick: () => set({ bg: null }) }, 'Remove')))
      : h('button', { class: 'btn wide', onclick: upload }, '📁 Upload hex map image'),
    h('div', { class: 'section-title' }, 'Fog of war'),
    isDM() ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: hx.fog, onchange: e => set({ fog: e.target.checked }) }), 'Hide unexplored hexes from players') : h('p', { class: 'hint' }, 'DM only'),
    isDM() ? h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => revealAll(true) }, 'Reveal all'),
      h('button', { class: 'btn', onclick: () => revealAll(false) }, 'Fog all')) : null,
    h('div', { class: 'section-title' }, 'Danger zone'),
    h('button', { class: 'btn danger wide', onclick: async () => {
      if (!await confirmDialog('Erase every painted hex, icon, label and note?', 'Erase all', true)) return;
      dispatch({ type: 'hex.paint', hexes: Object.keys(hx.hexes).map(k => ({ k, patch: { terrain: null, icon: null, label: null, note: null, dmNote: null, revealed: null } })) });
    } }, 'Clear hex map'),
    h('button', { class: 'btn wide', onclick: fitView }, 'Fit to screen'),
  ];
}

function revealAll(on) {
  const hx = store.state.hex;
  const hexes = [];
  for (let r = 0; r < hx.rows; r++) for (let c = 0; c < hx.cols; c++) hexes.push({ k: hexKey(c, r), patch: { revealed: on ? true : null } });
  dispatch({ type: 'hex.paint', hexes });
}

function inspectPanel() {
  const k = ui.selected;
  const [c, r] = parseHexKey(k);
  const hx = store.state.hex;
  const d = hx.hexes[k] || {};
  const fogged = hx.fog && !d.revealed && !isDM();
  const out = [
    h('div', { class: 'inspect-card' },
      h('div', { class: 'inspect-head' },
        h('span', { class: 'big-icon' }, HEX_ICONS[d.icon] || '⬡'),
        h('div', { class: 'grow' }, h('b', {}, d.label || `Hex ${hexLabel(c, r)}`), h('small', {}, fogged ? 'Unexplored' : (HEX_TERRAINS[d.terrain]?.label || 'Unpainted'))),
        h('button', { class: 'icon-btn', onclick: () => { ui.selected = null; buildSide(); dirty = true; } }, '✕')),
      !fogged && d.note ? h('p', { class: 'note' }, d.note) : null,
      isDM() && d.dmNote ? h('p', { class: 'note dm' }, '🔒 ', d.dmNote) : null,
      canEdit() ? h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => editHex(k) }, 'Edit hex'),
        isDM() ? h('button', { class: 'btn small', onclick: () => dispatch({ type: 'hex.moveParty', to: [c, r], dist: hx.party ? hexDistance(hx.party, [c, r], hx.orientation) : 0, terrainLabel: HEX_TERRAINS[d.terrain]?.label?.toLowerCase() }) }, 'Move party here') : null) : null),
  ];
  return out;
}

function editHex(k) {
  const d = store.state.hex.hexes[k] || {};
  const terrain = h('select', {}, h('option', { value: '' }, '— none —'), Object.entries(HEX_TERRAINS).map(([v, t]) => h('option', { value: v, selected: d.terrain === v }, t.label)));
  const icon = h('select', {}, h('option', { value: '' }, '— none —'), Object.entries(HEX_ICONS).map(([v, i]) => h('option', { value: v, selected: d.icon === v }, `${i} ${v}`)));
  const label = h('input', { type: 'text', value: d.label || '', maxlength: 40 });
  const note = h('textarea', { rows: 3 }, d.note || '');
  const dmNote = h('textarea', { rows: 3 }, d.dmNote || '');
  const revealed = h('input', { type: 'checkbox', checked: !!d.revealed });
  openModal({
    title: 'Edit hex ' + hexLabel(...parseHexKey(k)),
    body: h('div', {}, field('Terrain', terrain), field('Icon', icon), field('Label', label), field('Player-visible note', note),
      isDM() ? field('DM-only note', dmNote) : null, isDM() ? h('label', { class: 'check' }, revealed, 'Revealed to players') : null),
    actions: [{ label: 'Cancel' }, {
      label: 'Save', class: 'primary', onClick: () => {
        const data = { ...d, terrain: terrain.value || undefined, icon: icon.value || undefined, label: label.value.trim() || undefined, note: note.value.trim() || undefined };
        if (isDM()) { data.dmNote = dmNote.value.trim() || undefined; data.revealed = revealed.checked || undefined; }
        for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
        dispatch({ type: 'hex.setHex', k, data });
      },
    }],
  });
}

function travelPanel() {
  const hx = store.state.hex;
  const recent = store.state.adventure.filter(e => e.icon === 'boot' || e.icon === 'sun').slice(-12).reverse();
  const where = hx.party ? (hx.hexes[hexKey(...hx.party)]?.label || `Hex ${hexLabel(...hx.party)}`) : 'Not placed';
  return [
    h('div', { class: 'stat-tiles two' },
      h('div', { class: 'tile' }, h('small', {}, 'Day'), h('b', {}, hx.day)),
      h('div', { class: 'tile' }, h('small', {}, 'Hexes traveled'), h('b', {}, store.state.stats.party.hexes || 0))),
    h('p', {}, '📍 ', h('b', {}, where)),
    isDM() ? h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => setTool({ mode: 'party' }) }, '🛡️ Move party'),
      h('button', { class: 'btn', onclick: async () => {
        const note = await promptDialog('Advance day', 'What happened? (optional)', '');
        if (note !== null) dispatch({ type: 'hex.advanceDay', n: 1, note: note.trim() });
      } }, '☀ Next day')) : null,
    ui.tool.mode === 'party' ? h('p', { class: 'hint' }, 'Click a hex to move the party there. Esc to stop.') : null,
    h('div', { class: 'section-title' }, 'Recent travel'),
    recent.length ? h('div', { class: 'list' }, recent.map(e => h('div', { class: 'log-line' }, h('span', { class: 'ic' }, e.icon === 'sun' ? '☀' : '🥾'),
      h('div', { class: 'grow' }, h('div', {}, e.title), e.text ? h('small', {}, e.text) : null, h('small', {}, ' · ' + timeAgo(e.ts))))))
      : h('p', { class: 'hint' }, 'No travel yet.'),
  ];
}

