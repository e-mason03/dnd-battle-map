// ============================================================
// Battle view — BG3-style flow:
//   select a token → hover to preview path / click to move
//   pick an action on the hotbar → pick targets (or an AoE point)
//   → dice are rolled, the result animates for everyone
// ============================================================

import { store, subscribe, onOp, dispatch, isDM, canEdit, myToken, avatarOf } from '../store.js';
import { tokenView, healthFraction, healthLabel } from '../core/ops.js';
import { resolveAction, describeAction, unarmedStrike } from '../core/actions.js';
import { rollD20 } from '../core/dice.js';
import { uid, escapeHtml } from '../core/util.js';
import { h, $, toast } from '../ui/dom.js';
import { drawScene, colLabel } from './battleRender.js';
import { reachable, buildPath, cellKey, feetBetween } from './pathing.js';
import * as fx from './fx.js';
import { buildSidebar, openTokenEditor, openStartCombat, placeTokenFromTemplate } from './battlePanels.js';
import { sendRaw, onFx } from '../net.js';
import { openRollWindow } from '../ui/rollWindow.js';
import { computeCover, withManualCover, COVER_BONUS, COVER_LABEL } from '../core/cover.js';

const BASE_CELL = 44;

const ui = {
  cam: { x: 0, y: 0, s: BASE_CELL },
  zoom: 1,
  tool: { mode: 'select' },     // select | paint {cat,value} | place {template}
  selectedId: null,
  targeting: null,              // { action, targets: [ids] }
  adv: 0,
  hover: null,                  // { c, r, x, y (cell floats), tokenId }
  drag: null,
  settings: { grid: true, coords: false },
  visible: false,
};

let canvas, ctx, wrap, tip, hotbar, initBar, banner;
let dirty = true;
let centered = false;
let reachCache = null;
let mapRev = 0;          // bumps whenever the map's cells change (invalidates the ground cache)
const coverCache = new Map();

export const battleUI = ui;
export const requestRender = () => { dirty = true; };

// ------------------------------------------------------------
// Mount
// ------------------------------------------------------------

export function mountBattle(root) {
  canvas = h('canvas', { class: 'battle-canvas' });
  ctx = canvas.getContext('2d');
  tip = h('div', { class: 'map-tip' });
  hotbar = h('div', { class: 'hotbar' });
  initBar = h('div', { class: 'init-bar' });
  banner = h('div', { class: 'turn-banner' });
  wrap = h('div', { class: 'battle-stage' }, canvas, initBar, hotbar, tip, banner,
    h('div', { class: 'map-hint', id: 'battleHint' }));

  const side = h('aside', { class: 'side-panel', id: 'battleSide' });
  root.append(h('div', { class: 'battle-layout' }, wrap, side));

  new ResizeObserver(resizeCanvas).observe(wrap);
  bindInput();

  subscribe(changed => {
    if (!store.state) return;
    if (changed.has('*') || changed.has('map') || changed.has('battle') || changed.has('party')) {
      reachCache = null;
      coverCache.clear();
      if (changed.has('*') || changed.has('map')) mapRev++;
      if (ui.selectedId && !store.state.battle.tokens[ui.selectedId]) ui.selectedId = null;
      if (changed.has('*') && !centered) { centerMap(); centered = true; }
      renderHotbar();
      renderInitBar();
      dirty = true;
    }
    if (changed.has('*') || changed.has('meta') || changed.has('npcs') || changed.has('party') || changed.has('log') || changed.has('presence')) {
      buildSidebar($('#battleSide'));
    }
  });

  onOp((op, { local }) => {
    if (op.type === 'battle.moveToken') fx.animateMove(op.id, op.path);
    if (op.type === 'battle.action') fx.playAction(op, centerOf);
    if (op.type === 'battle.combatNext' || op.type === 'battle.combatStart') announceTurn();
    if (op.type === 'battle.setMap' || op.type === 'battle.loadMap') { centerMap(); }
    dirty = true;
  });

  onFx((f, by) => {
    if (f.kind === 'ping') { fx.ping(f.x, f.y); toast(`${by} pinged ${colLabel(Math.floor(f.x))}${Math.floor(f.y) + 1}`); }
  });

  requestAnimationFrame(loop);
}

export function showBattle(v) {
  ui.visible = v;
  if (v) { resizeCanvas(); dirty = true; }
}

let ambient = false;     // animated tiles (fire, water, fog…) on screen
let lastAmbient = 0;

function loop(t) {
  const combat = store.state?.battle.combat.active;
  // Animated tiles only need ~24 fps; combat and FX get full frame rate
  const ambientDue = ambient && t - lastAmbient > 40;
  if (ui.visible && store.state && (dirty || fx.isAnimating() || combat || ambientDue)) {
    dirty = false;
    lastAmbient = t;
    draw();
  }
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, hh = wrap.clientHeight;
  if (!w || !hh) return;
  canvas.width = w * dpr;
  canvas.height = hh * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = hh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!centered && store.state) { centerMap(); centered = true; }
  dirty = true;
}

export function centerMap() {
  if (!store.state || !wrap.clientWidth) return;
  const m = store.state.map;
  const fit = Math.min((wrap.clientWidth - 40) / (m.width * BASE_CELL), (wrap.clientHeight - 140) / (m.height * BASE_CELL), 1.4);
  ui.zoom = Math.max(0.25, fit);
  ui.cam.s = BASE_CELL * ui.zoom;
  ui.cam.x = (wrap.clientWidth - m.width * ui.cam.s) / 2;
  ui.cam.y = (wrap.clientHeight - m.height * ui.cam.s) / 2;
  dirty = true;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

const W = () => wrap.clientWidth;
const H = () => wrap.clientHeight;

function visibleTokens() {
  const s = store.state;
  return Object.values(s.battle.tokens).filter(t => isDM() || !t.hidden).map(t => tokenView(s, t));
}

function tokenAt(c, r) {
  let best = null;
  for (const t of visibleTokens()) {
    const sz = t.size || 1;
    if (c >= t.col && c < t.col + sz && r >= t.row && r < t.row + sz) {
      if (!best || (best.conditions.includes('dead') && !t.conditions.includes('dead'))) best = t;
    }
  }
  return best;
}

function centerOf(id) {
  const t = store.state.battle.tokens[id];
  if (!t) return null;
  const sz = t.size || 1;
  return { x: t.col + sz / 2, y: t.row + sz / 2 };
}

const sideOf = t => t.side || (t.isPC ? 'party' : 'enemy');
const hostile = (a, b) => (sideOf(a) === 'enemy') !== (sideOf(b) === 'enemy');

function selectedView() {
  const t = ui.selectedId && store.state.battle.tokens[ui.selectedId];
  return t ? tokenView(store.state, t) : null;
}

function screenToCell(mx, my) {
  const x = (mx - ui.cam.x) / ui.cam.s, y = (my - ui.cam.y) / ui.cam.s;
  return { c: Math.floor(x), r: Math.floor(y), x, y };
}

const inMap = (c, r) => c >= 0 && r >= 0 && c < store.state.map.width && r < store.state.map.height;

function turnState(id) {
  return store.state.battle.combat.turnState[id] || {};
}

function movementLeft(v) {
  const c = store.state.battle.combat;
  if (!c.active) return 9999;
  const ts = turnState(v.id);
  return Math.max(0, (v.speed || 30) * (ts.dash ? 2 : 1) - (ts.moved || 0));
}

function currentTurnId() {
  const c = store.state.battle.combat;
  return c.active ? c.order[c.turn]?.id : null;
}

function getReach(v) {
  const left = movementLeft(v);
  const key = `${v.id}:${v.col},${v.row}:${left}`;
  if (reachCache?.key === key) return reachCache;
  const blockers = new Map();
  for (const t of visibleTokens()) {
    if (t.id === v.id || t.conditions.includes('dead')) continue;
    const kind = hostile(t, v) ? 'enemy' : 'ally';
    for (let dr = 0; dr < (t.size || 1); dr++) {
      for (let dc = 0; dc < (t.size || 1); dc++) blockers.set(cellKey(t.col + dc, t.row + dr), kind);
    }
  }
  const res = reachable(store.state.map, [v.col, v.row], left, blockers, v.size || 1);
  reachCache = { key, ...res, blockers, left };
  return reachCache;
}

function canControl(v) {
  return !!v && myToken(store.state.battle.tokens[v.id]);
}

function actionsFor(v) {
  const list = v.actions?.length ? v.actions : [unarmedStrike(10, 2)];
  return list;
}

function slotAvailable(v, a) {
  if (!a.slot || !v.isPC) return true;
  const ch = store.state.party.chars[v.charId];
  if (!ch) return true;
  if (a.pact) return ch.pact && ch.pact.used < ch.pact.max;
  return (ch.slots || []).some(sl => sl.level >= a.slot && sl.used < sl.max);
}

// Upcasts to the lowest available slot at or above the spell's level
function withSlot(v, a) {
  if (!a.slot || !v.isPC || a.pact) return a;
  const ch = store.state.party.chars[v.charId];
  const sl = (ch?.slots || []).filter(x => x.level >= a.slot && x.used < x.max).sort((x, y) => x.level - y.level)[0];
  return sl ? { ...a, slot: sl.level } : a;
}

// ------------------------------------------------------------
// Drawing
// ------------------------------------------------------------

function draw() {
  const s = store.state;
  const ov = { selectedId: ui.selectedId, turnId: currentTurnId(), targets: ui.targeting?.targets };
  const sel = selectedView();
  const hv = ui.hover;

  if (ui.targeting && sel) {
    const a = ui.targeting.action;
    const sz = sel.size || 1;
    ov.range = { x: sel.col + sz / 2, y: sel.row + sz / 2, r: a.range / 5 + sz / 2 };
    if (a.radius && hv && inMap(hv.c, hv.r)) {
      ov.aoe = { x: hv.c + 0.5, y: hv.r + 0.5, r: a.radius / 5, ok: feetBetween(sel, { col: hv.c, row: hv.r }) <= a.range };
      if (a.kind === 'save') ov.cover = new Map(aoeTargets(hv.c, hv.r, a.radius, true).map(t => [t.id, t.cover]));
    } else if (!a.radius) {
      if (hv?.tokenId) ov.hoverTargetId = hv.tokenId;
      // Badge every creature that has cover (heals/auto-hits only care about total cover)
      ov.cover = new Map();
      for (const t of visibleTokens()) {
        if (t.id === sel.id || t.conditions.includes('dead')) continue;
        const lvl = coverFor(sel, t);
        if (a.kind === 'heal' || a.kind === 'auto' ? lvl === 'total' : lvl !== 'none') ov.cover.set(t.id, lvl);
      }
      const ht = hv?.tokenId && visibleTokens().find(t => t.id === hv.tokenId);
      if (ht && ht.id !== sel.id) {
        const tsz = ht.size || 1;
        ov.los = { from: [sel.col + sz / 2, sel.row + sz / 2], to: [ht.col + tsz / 2, ht.row + tsz / 2], level: coverFor(sel, ht) };
      }
    }
  } else if (sel && canControl(sel) && ui.tool.mode === 'select' && !ui.drag) {
    const rc = getReach(sel);
    if (s.battle.combat.active && rc.left < 9999) ov.reach = rc.dist;
    if (hv && inMap(hv.c, hv.r) && !hv.tokenId && (hv.c !== sel.col || hv.r !== sel.row)) {
      const cost = rc.dist.get(cellKey(hv.c, hv.r));
      if (cost !== undefined) {
        ov.path = buildPath(rc, [sel.col, sel.row], [hv.c, hv.r]);
        ov.pathOk = true;
        ov.pathEnd = [hv.c, hv.r];
        ov.pathLabel = `${cost} ft` + (s.battle.combat.active ? ` · ${rc.left - cost} left` : '');
      } else {
        ov.path = [[sel.col, sel.row], [hv.c, hv.r]];
        ov.pathOk = false;
        ov.pathEnd = [hv.c, hv.r];
        ov.pathLabel = 'Out of reach';
      }
    }
  }
  if (ui.drag?.kind === 'token' && ui.drag.moved && hv) {
    ov.path = [[ui.drag.from[0], ui.drag.from[1]], [hv.c, hv.r]];
    ov.pathOk = inMap(hv.c, hv.r);
  }

  ambient = drawScene(ctx, W(), H(), {
    state: s, cam: ui.cam, isDM: isDM(), overlays: ov, settings: ui.settings, onImage: requestRender, mapRev,
  }).animated;

  if (ui.tool.mode === 'paint' && hv && inMap(hv.c, hv.r)) {
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.strokeRect(hv.c * ui.cam.s + ui.cam.x + 1, hv.r * ui.cam.s + ui.cam.y + 1, ui.cam.s - 2, ui.cam.s - 2);
  }
}

// ------------------------------------------------------------
// Input
// ------------------------------------------------------------

let spaceHeld = false;
let paintBuffer = [];
let paintTimer = null;

function flushPaint() {
  if (paintBuffer.length) dispatch({ type: 'battle.paint', cells: paintBuffer });
  paintBuffer = [];
  paintTimer = null;
}

function paintAt(c, r, erase) {
  if (!inMap(c, r)) return;
  const { cat, value } = ui.tool;
  const cell = store.state.map.cells[r][c];
  const patch = { c, r };
  if (cat === 'terrain') { patch.terrain = erase ? (store.state.map.bg ? 'none' : 'grass') : value; if (cell.terrain === patch.terrain) return; }
  if (cat === 'elevation') { patch.elevation = erase ? 0 : value; if (cell.elevation === patch.elevation) return; }
  if (cat === 'feature') { patch.feature = erase ? null : value; if (cell.feature === patch.feature) return; }
  // Apply locally right away; the batched op will re-apply idempotently
  Object.assign(cell, patch);
  delete cell.c; delete cell.r;
  paintBuffer.push(patch);
  mapRev++;
  if (!paintTimer) paintTimer = setTimeout(flushPaint, 120);
  dirty = true;
}

function bindInput() {
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousedown', e => {
    if (!store.state) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const { c, r, x, y } = screenToCell(mx, my);

    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y, moved: false };
      return;
    }

    if (e.button === 2) {
      if (ui.targeting) { cancelTargeting(); return; }
      if (ui.tool.mode === 'paint') { ui.drag = { kind: 'paint', erase: true }; paintAt(c, r, true); return; }
      if (ui.tool.mode === 'place') { setTool({ mode: 'select' }); return; }
      ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y, moved: false, right: true };
      return;
    }

    if (e.altKey) {
      sendRaw({ type: 'fx', fx: { kind: 'ping', x, y } });
      fx.ping(x, y);
      return;
    }

    if (ui.targeting) { handleTargetClick(c, r); return; }

    if (ui.tool.mode === 'paint') {
      ui.drag = { kind: 'paint' };
      paintAt(c, r, false);
      return;
    }

    if (ui.tool.mode === 'place') {
      if (inMap(c, r)) placeTokenFromTemplate(ui.tool.template, c, r);
      if (!e.shiftKey) setTool({ mode: 'select' });
      return;
    }

    // Select mode
    const t = inMap(c, r) ? tokenAt(c, r) : null;
    if (t) {
      if (e.detail === 2 && (canControl(t) || canEdit())) { openTokenEditor(t.id); return; }
      ui.selectedId = t.id;
      cancelTargeting(false);
      const freeDrag = isDM() || canEdit() || (canControl(t) && !store.state.battle.combat.active);
      if (canControl(t) && freeDrag) {
        ui.drag = { kind: 'token', id: t.id, from: [t.col, t.row], sx: e.clientX, sy: e.clientY, moved: false };
      }
      renderHotbar();
      dirty = true;
      return;
    }

    const sel = selectedView();
    if (sel && canControl(sel) && inMap(c, r)) {
      if (tryMove(sel, c, r)) return;
    }
    ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y, moved: false, deselect: true };
  });

  window.addEventListener('mousemove', e => {
    if (!ui.visible || !store.state) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const d = ui.drag;

    if (d?.kind === 'pan') {
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      ui.cam.x = d.cx + (e.clientX - d.sx);
      ui.cam.y = d.cy + (e.clientY - d.sy);
      dirty = true;
      return;
    }
    if (d?.kind === 'token' && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;

    const inside = mx >= 0 && my >= 0 && mx <= rect.width && my <= rect.height;
    if (!inside && !d) { if (ui.hover) { ui.hover = null; tip.style.display = 'none'; dirty = true; } return; }

    const { c, r, x, y } = screenToCell(mx, my);
    const t = inMap(c, r) ? tokenAt(c, r) : null;
    const changed = !ui.hover || ui.hover.c !== c || ui.hover.r !== r;
    ui.hover = { c, r, x, y, tokenId: t?.id || null };
    if (d?.kind === 'paint' && changed) paintAt(c, r, d.erase);
    if (changed) dirty = true;
    updateTip(e.clientX - rect.left, e.clientY - rect.top, t);
    $('#coordDisplay') && ($('#coordDisplay').textContent = inMap(c, r) ? `${colLabel(c)}${r + 1}` : '—');
  });

  window.addEventListener('mouseup', e => {
    const d = ui.drag;
    ui.drag = null;
    if (!d) return;
    if (d.kind === 'paint') { flushPaint(); return; }
    if (d.kind === 'pan' && !d.moved && d.deselect) {
      ui.selectedId = null;
      renderHotbar();
    }
    if (d.kind === 'token' && d.moved && ui.hover) {
      const { c, r } = ui.hover;
      const t = store.state.battle.tokens[d.id];
      if (t && inMap(c, r) && (c !== t.col || r !== t.row)) {
        const occ = tokenAt(c, r);
        if (!occ || occ.id === t.id || occ.conditions.includes('dead')) {
          dispatch({ type: 'battle.moveToken', id: d.id, path: [[t.col, t.row], [c, r]] });
        }
      }
    }
    dirty = true;
  });

  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const old = ui.zoom;
    ui.zoom = Math.max(0.2, Math.min(4, ui.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    const k = ui.zoom / old;
    ui.cam.x = mx - k * (mx - ui.cam.x);
    ui.cam.y = my - k * (my - ui.cam.y);
    ui.cam.s = BASE_CELL * ui.zoom;
    dirty = true;
  }, { passive: false });

  document.addEventListener('keydown', e => {
    if (!ui.visible || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (document.querySelector('.modal-overlay')) return;
    if (e.key === ' ') { spaceHeld = true; e.preventDefault(); }
    if (e.key === 'Escape') {
      if (ui.targeting) cancelTargeting();
      else if (ui.tool.mode !== 'select') setTool({ mode: 'select' });
      else { ui.selectedId = null; renderHotbar(); }
      dirty = true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selectedId && (isDM() || canEdit())) {
      dispatch({ type: 'battle.removeToken', id: ui.selectedId });
      ui.selectedId = null;
      renderHotbar();
    }
    const sel = selectedView();
    if (sel && canControl(sel) && /^[1-9]$/.test(e.key)) {
      const a = actionsFor(sel)[parseInt(e.key, 10) - 1];
      if (a) startTargeting(a);
    }
    if (e.key.toLowerCase() === 'e' && sel && canControl(sel) && currentTurnId() === sel.id) endTurn();
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') spaceHeld = false; });
}

function tryMove(sel, c, r) {
  const occ = tokenAt(c, r);
  if (occ && occ.id !== sel.id && !occ.conditions.includes('dead')) return false;
  const rc = getReach(sel);
  const cost = rc.dist.get(cellKey(c, r));
  if (cost === undefined) {
    toast(store.state.battle.combat.active ? `Not enough movement (${rc.left} ft left)` : "Can't reach there", true);
    return true;
  }
  const path = buildPath(rc, [sel.col, sel.row], [c, r]);
  if (!path) return false;
  dispatch({ type: 'battle.moveToken', id: sel.id, path, cost: store.state.battle.combat.active ? cost : 0 });
  return true;
}

// ------------------------------------------------------------
// Tooltip
// ------------------------------------------------------------

function updateTip(x, y, t) {
  const sel = selectedView();
  let html = '';
  if (ui.targeting && sel) {
    const a = ui.targeting.action;
    if (a.radius) {
      const hv = ui.hover;
      if (hv && inMap(hv.c, hv.r)) {
        const hit = aoeTargets(hv.c, hv.r, a.radius, true);
        const n = hit.length;
        const covered = hit.filter(x => x.cover !== 'none').length;
        const ok = feetBetween(sel, { col: hv.c, row: hv.r }) <= a.range;
        html = ok ? `<b>${escapeHtml(a.name)}</b><br>${n} creature${n === 1 ? '' : 's'} in area` +
          (covered && a.save === 'dex' ? `<br><small>${covered} behind cover (DEX save bonus)</small>` : '')
          : '<span class="bad">Out of range</span>';
      }
    } else if (t) {
      const dist = feetBetween(sel, t);
      const cover = t.id === sel.id ? 'none' : coverFor(sel, t);
      const cb = COVER_BONUS[cover] || 0;
      html = `<b>${escapeHtml(t.name)}</b>`;
      if (dist > a.range) html += `<br><span class="bad">Out of range (${dist} ft / ${a.range} ft)</span>`;
      else if (cover === 'total') html += '<br><span class="bad">Total cover — no line of sight</span>';
      else if (a.kind === 'save') {
        const dexCover = a.save === 'dex' ? cb : 0;
        html += `<br><span class="chance">DC ${a.dc}</span> ${a.save.toUpperCase()} save` +
          (dexCover ? `<br><span class="cover">🛡 ${COVER_LABEL[cover]}: +${dexCover} to the save</span>` : '');
      } else if (a.kind === 'heal') html += `<br>Heal ${escapeHtml(a.damage)}`;
      else if (a.kind === 'auto') html += '<br><span class="chance">Always hits</span>';
      else {
        const advNote = ui.adv ? (ui.adv > 0 ? ' (adv.)' : ' (disadv.)') : '';
        html += `<br><span class="chance">${(a.bonus || 0) >= 0 ? '+' : ''}${a.bonus || 0}</span> to hit${advNote}` +
          (cb ? `<br><span class="cover">🛡 ${COVER_LABEL[cover]}: +${cb} AC</span>` : '');
      }
    }
  } else if (t) {
    const exact = !t.redacted && (isDM() || t.isPC || canControl(t));
    const desc = healthLabel(t);
    html = `<b>${escapeHtml(t.name)}</b>${t.hidden ? ' <i>(hidden)</i>' : ''}<br>` +
      (exact ? `HP ${t.hp}/${t.maxHp}${t.tempHp ? ` (+${t.tempHp})` : ''} · AC ${t.ac ?? '?'}` : desc) +
      (t.conditions.length ? `<br><small>${t.conditions.map(escapeHtml).join(', ')}</small>` : '');
  }
  if (!html) { tip.style.display = 'none'; return; }
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(x + 16, W() - 200) + 'px';
  tip.style.top = (y + 16) + 'px';
}

// ------------------------------------------------------------
// Targeting
// ------------------------------------------------------------

function startTargeting(action) {
  const sel = selectedView();
  if (!sel || !canControl(sel)) return;
  if (!slotAvailable(sel, action)) {
    if (!isDM()) { toast('No spell slots left for ' + action.name, true); return; }
    toast('No slots left — casting anyway (DM)');
  }
  ui.targeting = { action, targets: [] };
  setHint(action.radius
    ? `Click a point within ${action.range} ft · right-click to cancel`
    : `Choose ${action.targets > 1 ? `up to ${action.targets} targets` : 'a target'} · right-click to cancel`);
  renderHotbar();
  dirty = true;
}

function cancelTargeting(rerender = true) {
  if (!ui.targeting) return;
  ui.targeting = null;
  tip.style.display = 'none';
  setHint('');
  if (rerender) renderHotbar();
  dirty = true;
}

// Creatures caught in an area, with the cover each has from its origin.
// Total cover shields a creature completely (the effect can't reach it).
function aoeTargets(c, r, radiusFt, withCover = false) {
  const R = radiusFt / 5;
  const inArea = visibleTokens().filter(t => {
    if (t.conditions.includes('dead')) return false;
    const sz = t.size || 1;
    for (let dr = 0; dr < sz; dr++) {
      for (let dc = 0; dc < sz; dc++) {
        if (Math.hypot(t.col + dc - c, t.row + dr - r) <= R + 0.01) return true;
      }
    }
    return false;
  });
  if (!withCover) return inArea;
  return inArea
    .map(t => {
      const auto = computeCover(store.state.map, { from: { id: '__origin', col: c, row: r, size: 1 }, point: [c + 0.5, r + 0.5], target: t });
      return { ...t, cover: withManualCover(auto, t.conditions) };
    })
    .filter(t => t.cover !== 'total');
}

// Cover `t` has against attacks from `sel` (cached until the board changes)
function coverFor(sel, t) {
  const key = `${sel.id}@${sel.col},${sel.row}>${t.id}@${t.col},${t.row}`;
  let lvl = coverCache.get(key);
  if (lvl === undefined) {
    const others = visibleTokens().filter(o => !o.conditions.includes('dead'));
    lvl = withManualCover(computeCover(store.state.map, { from: sel, target: t, others }), t.conditions);
    coverCache.set(key, lvl);
  }
  return lvl;
}

function handleTargetClick(c, r) {
  const sel = selectedView();
  const tg = ui.targeting;
  if (!sel || !tg) return;
  const a = tg.action;

  if (a.radius) {
    if (!inMap(c, r)) return;
    if (feetBetween(sel, { col: c, row: r }) > a.range) { toast('Out of range', true); return; }
    fire(aoeTargets(c, r, a.radius, a.kind === 'save'), [c, r]);
    return;
  }
  const t = inMap(c, r) ? tokenAt(c, r) : null;
  if (!t) return;
  if (feetBetween(sel, t) > a.range) { toast(`Out of range (${feetBetween(sel, t)} ft)`, true); return; }
  if (t.id !== sel.id && coverFor(sel, t) === 'total') { toast(`No line of sight to ${t.name} (total cover)`, true); return; }
  tg.targets.push(t.id);
  if (tg.targets.length >= (a.targets || 1)) {
    fire(targetViews(tg.targets), null);
  } else {
    renderHotbar();
    dirty = true;
  }
}

// Token views for chosen targets, tagged with the cover they have from the actor
function targetViews(ids) {
  const sel = selectedView();
  return ids.map(id => visibleTokens().find(v => v.id === id)).filter(Boolean)
    .map(t => ({ ...t, cover: t.id === sel.id ? 'none' : coverFor(sel, t) }));
}

function fire(targets, point) {
  const sel = selectedView();
  const a = withSlot(sel, ui.targeting.action);
  if (isDM()) {
    // The DM rolls instantly to keep monster turns moving
    dispatch(resolveAction(sel, a, targets, { adv: ui.adv, point }));
  } else {
    // Players roll their own dice; the room resolves hits (monster AC is secret)
    // and the result animates when it answers
    openRollWindow({ actor: sel, action: a, targets, adv: ui.adv, point, onCommit: op => dispatch(op, { optimistic: false }) });
  }
  ui.targeting = null;
  ui.adv = 0;
  tip.style.display = 'none';
  setHint('');
  renderHotbar();
}

function setHint(text) {
  const el = $('#battleHint');
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

export function setTool(tool) {
  ui.tool = tool;
  cancelTargeting(false);
  setHint(tool.mode === 'place' ? `Click to place ${tool.template.name} · shift-click for several · Esc to stop`
    : tool.mode === 'paint' ? 'Drag to paint · right-drag to erase · Esc to stop' : '');
  wrap.classList.toggle('painting', tool.mode !== 'select');
  buildSidebar($('#battleSide'));
  dirty = true;
}

// ------------------------------------------------------------
// Turn flow
// ------------------------------------------------------------

function endTurn() {
  cancelTargeting(false);
  dispatch({ type: 'battle.combatNext' });
}

function announceTurn() {
  const id = currentTurnId();
  const t = id && store.state.battle.tokens[id];
  if (!t) return;
  const v = tokenView(store.state, t);
  if (canControl(v) && !isDM()) {
    ui.selectedId = id;
    showBanner(`Your turn — ${v.name}`);
  } else if (isDM()) {
    ui.selectedId = id;
    showBanner(`${v.name}'s turn`, true);
  } else if (!t.hidden) {
    showBanner(`${v.name}'s turn`, true);
  }
  renderHotbar();
}

function showBanner(text, subtle) {
  banner.textContent = text;
  banner.className = 'turn-banner show' + (subtle ? ' subtle' : '');
  clearTimeout(showBanner.t);
  showBanner.t = setTimeout(() => { banner.className = 'turn-banner'; }, 1800);
}

// ------------------------------------------------------------
// Hotbar (bottom) — portrait, economy, actions
// ------------------------------------------------------------

const KIND_ICON = { melee: '⚔️', ranged: '🏹', spell: '✨', save: '💥', heal: '💚', auto: '🎯' };

export function renderHotbar() {
  if (!hotbar || !store.state) return;
  const v = selectedView();
  hotbar.innerHTML = '';
  if (!v) { hotbar.classList.remove('show'); return; }
  hotbar.classList.add('show');
  const mine = canControl(v);
  const combat = store.state.battle.combat;
  const ts = turnState(v.id);
  const pct = healthFraction(v);
  const exact = !v.redacted && (isDM() || mine || v.isPC);

  const portrait = h('div', { class: 'hb-portrait', style: { background: v.color || '#555' } },
    avatarOf(v) ? h('img', { src: avatarOf(v), alt: '' }) : (v.name || '?').slice(0, 2).toUpperCase());

  const info = h('div', { class: 'hb-info' },
    h('div', { class: 'hb-name' }, v.name, v.hidden ? h('span', { class: 'tag' }, 'hidden') : null),
    h('div', { class: 'hb-hp' },
      h('div', { class: 'hb-hpbar' }, h('div', { style: { width: (pct * 100) + '%', background: pct > 0.6 ? '#2ecc71' : pct > 0.3 ? '#e67e22' : '#e74c3c' } })),
      h('span', {}, exact ? `${v.hp}/${v.maxHp}${v.tempHp ? ` +${v.tempHp}` : ''}` : healthLabel(v))),
    h('div', { class: 'hb-stats' },
      exact ? h('span', { title: 'Armor Class' }, '🛡 ', v.ac ?? '?') : null,
      h('span', { title: 'Speed' }, '👣 ', combat.active && mine ? `${movementLeft(v)}/${(v.speed || 30) * (ts.dash ? 2 : 1)} ft` : `${v.speed || 30} ft`),
      v.conditions.length ? h('span', { class: 'conds' }, v.conditions.join(', ')) : null),
  );
  hotbar.append(portrait, info);

  if (!mine) return;

  if (combat.active) {
    hotbar.append(h('div', { class: 'hb-economy' },
      h('span', { class: 'pip action' + (ts.action ? ' used' : ''), title: 'Action' }),
      h('span', { class: 'pip bonus' + (ts.bonus ? ' used' : ''), title: 'Bonus action' })));
  }

  const acts = h('div', { class: 'hb-actions' });
  actionsFor(v).forEach((a, i) => {
    const noSlot = !slotAvailable(v, a);
    const spent = combat.active && (a.cost === 'bonus' ? ts.bonus : ts.action);
    const active = ui.targeting?.action.id === a.id && ui.targeting?.action.name === a.name;
    acts.append(h('button', {
      class: 'hb-action' + (active ? ' active' : '') + (noSlot || spent ? ' dim' : '') + (a.cost === 'bonus' ? ' bonus' : ''),
      title: `${a.name}\n${describeAction(a)}${i < 9 ? `\nHotkey: ${i + 1}` : ''}`,
      onclick: () => (active ? cancelTargeting() : startTargeting(a)),
    }, h('span', { class: 'ic' }, KIND_ICON[a.kind] || '⚔️'), h('span', { class: 'lbl' }, a.name), i < 9 ? h('kbd', {}, i + 1) : null));
  });
  hotbar.append(acts);

  const ch = v.isPC ? store.state.party.chars[v.charId] : null;
  if (ch && (ch.slots?.length || ch.pact)) {
    const slots = h('div', { class: 'hb-slots', title: 'Spell slots' });
    for (const sl of ch.slots || []) {
      slots.append(h('div', { class: 'slot-col' }, h('small', {}, sl.level),
        ...Array.from({ length: sl.max }, (_, k) => h('i', { class: k < sl.max - sl.used ? 'on' : '' }))));
    }
    if (ch.pact) {
      slots.append(h('div', { class: 'slot-col pact' }, h('small', {}, 'P' + ch.pact.level),
        ...Array.from({ length: ch.pact.max }, (_, k) => h('i', { class: k < ch.pact.max - ch.pact.used ? 'on' : '' }))));
    }
    hotbar.append(slots);
  }

  const advLabel = ui.adv > 0 ? 'Advantage' : ui.adv < 0 ? 'Disadvantage' : 'Normal roll';
  const extras = h('div', { class: 'hb-extras' },
    h('button', { class: 'btn small' + (ui.adv ? ' active' : ''), title: 'Cycle normal / advantage / disadvantage', onclick: () => { ui.adv = ui.adv === 0 ? 1 : ui.adv === 1 ? -1 : 0; renderHotbar(); } }, advLabel),
  );
  if (ui.targeting && (ui.targeting.action.targets || 1) > 1 && ui.targeting.targets.length) {
    extras.append(h('button', { class: 'btn small primary', onclick: () => {
      fire(targetViews(ui.targeting.targets), null);
    } }, `Fire (${ui.targeting.targets.length}/${ui.targeting.action.targets})`));
  }
  if (combat.active) {
    extras.append(h('button', { class: 'btn small', disabled: ts.dash, onclick: () => dispatch({ type: 'battle.turnState', id: v.id, patch: { dash: true, action: true } }) }, 'Dash'));
    if (currentTurnId() === v.id) extras.append(h('button', { class: 'btn small primary', onclick: endTurn, title: 'Hotkey: E' }, 'End Turn ⏎'));
  }
  extras.append(h('button', { class: 'btn small', title: 'Roll initiative / check', onclick: () => quickInitiative(v) }, '🎲 Init'));
  extras.append(h('button', { class: 'btn small', onclick: () => openTokenEditor(v.id) }, 'Edit'));
  hotbar.append(extras);
}

function quickInitiative(v) {
  const d = rollD20();
  const total = d.value + (v.initBonus || 0);
  dispatch({ type: 'dice.roll', notation: `1d20${v.initBonus >= 0 ? '+' : ''}${v.initBonus || 0}`, label: `${v.name} initiative`, rolls: [{ sides: 20, value: d.value }], total });
  dispatch({ type: 'battle.setInit', id: v.id, initiative: total });
  toast(`${v.name} rolls ${total} for initiative`);
}

// ------------------------------------------------------------
// Initiative bar (top)
// ------------------------------------------------------------

function renderInitBar() {
  if (!initBar || !store.state) return;
  const c = store.state.battle.combat;
  initBar.innerHTML = '';
  if (!c.active) {
    if (isDM()) initBar.append(h('button', { class: 'btn start-combat', onclick: openStartCombat }, '⚔ Start Combat'));
    initBar.classList.toggle('show', isDM());
    return;
  }
  initBar.classList.add('show');
  initBar.append(h('div', { class: 'round' }, h('small', {}, 'Round'), h('b', {}, c.round)));
  const list = h('div', { class: 'init-list' });
  c.order.forEach((o, i) => {
    const t = store.state.battle.tokens[o.id];
    if (!t || (t.hidden && !isDM())) return;
    const v = tokenView(store.state, t);
    const pct = healthFraction(v);
    list.append(h('div', {
      class: 'init-card' + (i === c.turn ? ' current' : '') + (v.conditions.includes('dead') ? ' dead' : '') + ` side-${sideOf(v)}`,
      title: `${v.name} — initiative ${o.init}`,
      onclick: () => { ui.selectedId = o.id; panTo(o.id); renderHotbar(); dirty = true; },
    },
    h('div', { class: 'face', style: { background: v.color || '#555' } }, avatarOf(v) ? h('img', { src: avatarOf(v), alt: '' }) : v.name.slice(0, 2).toUpperCase()),
    h('div', { class: 'mini-hp' }, h('div', { style: { width: pct * 100 + '%' } })),
    h('small', {}, o.init)));
  });
  initBar.append(list);
  if (isDM()) {
    initBar.append(h('div', { class: 'init-ctl' },
      h('button', { class: 'btn small', onclick: () => dispatch({ type: 'battle.combatPrev' }) }, '◀'),
      h('button', { class: 'btn small primary', onclick: endTurn }, 'Next ▶'),
      h('button', { class: 'btn small danger', onclick: () => dispatch({ type: 'battle.combatEnd' }) }, 'End')));
  } else {
    const cur = store.state.battle.tokens[currentTurnId()];
    if (cur && myToken(cur)) initBar.append(h('button', { class: 'btn small primary', onclick: endTurn }, 'End Turn'));
  }
}

function panTo(id) {
  const p = centerOf(id);
  if (!p) return;
  ui.cam.x = W() / 2 - p.x * ui.cam.s;
  ui.cam.y = H() / 2 - p.y * ui.cam.s;
  dirty = true;
}

export function exportPng() {
  const m = store.state.map;
  const s = 48;
  const off = document.createElement('canvas');
  off.width = m.width * s;
  off.height = m.height * s;
  drawScene(off.getContext('2d'), off.width, off.height, {
    state: store.state, cam: { x: 0, y: 0, s }, isDM: false, overlays: {}, settings: ui.settings,
  });
  try {
    const a = document.createElement('a');
    a.download = (store.state.meta.name || 'battle-map').replace(/\W+/g, '-') + '.png';
    a.href = off.toDataURL('image/png');
    a.click();
  } catch {
    toast('Export blocked by an external avatar image — try hiding PC tokens', true);
  }
}

export function newTokenId() { return 't-' + uid(8); }
