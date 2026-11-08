// ============================================================
// Battle side panel (build palette, token roster, live log),
// token editor, map management and the start-combat dialog
// ============================================================

import { store, dispatch, isDM, canEdit, myToken, fileUrl } from '../store.js';
import { tokenView, makeCells } from '../core/ops.js';
import { parseActionText, actionsToText } from '../core/actions.js';
import { rollD20 } from '../core/dice.js';
import { uid, ABILITIES } from '../core/util.js';
import { TERRAINS, ELEVATIONS, FEATURES, MONSTER_TOKENS, PLAYER_TOKENS, ALL_TOKENS, CONDITIONS, MONSTER_ART, tokenDef } from '../constants.js';
import { h, toast, openModal, confirmDialog, promptDialog, field, pickFile, fmtTime } from '../ui/dom.js';
import { uploadImage } from '../net.js';
import { textureSwatch } from './textures.js';
import { battleUI as ui, setTool, centerMap, exportPng, requestRender, renderHotbar } from './battle.js';

let tab = null;
let placeHidden = false;

// ------------------------------------------------------------
// Sidebar
// ------------------------------------------------------------

export function buildSidebar(root) {
  if (!root || !store.state) return;
  const editor = canEdit();
  if (!tab || (tab === 'build' && !editor)) tab = editor ? 'build' : 'tokens';
  const logScroll = root.querySelector('.log-feed');
  const atBottom = !logScroll || logScroll.scrollTop + logScroll.clientHeight >= logScroll.scrollHeight - 30;
  const keepScroll = root.querySelector('.side-body')?.scrollTop || 0;

  root.innerHTML = '';
  const tabs = h('div', { class: 'side-tabs' },
    editor ? tabBtn('build', 'Build') : null, tabBtn('tokens', 'Tokens'), tabBtn('log', 'Log'));
  const body = h('div', { class: 'side-body' });
  root.append(tabs, body);

  body.append(...{ build: buildTab, tokens: tokensTab, log: logTab }[tab]().filter(Boolean));

  if (tab !== 'log') body.scrollTop = keepScroll;
  const feed = root.querySelector('.log-feed');
  if (feed && atBottom) feed.scrollTop = feed.scrollHeight;

  function tabBtn(key, label) {
    return h('button', { class: 'side-tab' + (tab === key ? ' active' : ''), onclick: () => { tab = key; buildSidebar(root); } }, label);
  }
}

// The token list reflects live positions/HP/hidden state, so it redraws on
// battle changes — but only while open, since a rebuild would wipe the Log
// tab's note input mid-typing
export function refreshTokensTab(root) {
  if (tab === 'tokens') buildSidebar(root);
}

function toolBtn(label, swatch, active, onclick, title) {
  return h('button', { class: 'tool-btn' + (active ? ' selected' : ''), onclick, title: title || label }, swatch, h('span', {}, label));
}

function buildTab() {
  const t = ui.tool;
  const isPaint = (cat, v) => t.mode === 'paint' && t.cat === cat && t.value === v;
  const paint = (cat, value) => () => setTool(isPaint(cat, value) ? { mode: 'select' } : { mode: 'paint', cat, value });
  const map = store.state.map;

  const out = [
    h('button', { class: 'btn wide' + (t.mode === 'select' ? ' active' : ''), onclick: () => setTool({ mode: 'select' }) }, '🖱 Select / Move tokens'),
    h('div', { class: 'section-title' }, 'Terrain'),
    h('div', { class: 'grid-3' }, Object.entries(TERRAINS).map(([k, v]) =>
      toolBtn(v.label, h('div', { class: 'swatch' + (k === 'none' ? ' clear' : ''), style: textureSwatch(k) ? { backgroundImage: `url(${textureSwatch(k)})`, backgroundSize: 'cover' } : { background: v.color } }), isPaint('terrain', k), paint('terrain', k)))),
    h('div', { class: 'section-title' }, 'Elevation & Walls'),
    h('div', { class: 'grid-3' }, ELEVATIONS.map(e =>
      toolBtn(e.label, h('div', { class: 'swatch', style: { background: e.isWall ? '#111' : '#3d6b47', border: e.bw ? `${e.bw}px solid ${e.bc}` : '1px solid #333' } }, e.marker || ''), isPaint('elevation', e.level), paint('elevation', e.level)))),
    h('div', { class: 'section-title' }, 'Obstacles & cover'),
    h('div', { class: 'grid-3' }, Object.entries(FEATURES).filter(([, f]) => f.obstacle).map(([k, f]) =>
      toolBtn(f.label, h('div', { class: 'swatch icon' }, f.icon), isPaint('feature', k), paint('feature', k),
        `${f.label} — ${f.cover === 'three' ? 'three-quarters' : 'half'} cover, ${f.blocks ? 'blocks movement' : 'difficult terrain'}`))),
    h('p', { class: 'hint' }, 'Walls and closed doors give total cover. Creatures in the way give half cover.'),
    h('div', { class: 'section-title' }, 'Features'),
    h('div', { class: 'grid-3' }, Object.entries(FEATURES).filter(([, f]) => !f.obstacle).map(([k, f]) =>
      toolBtn(f.label, h('div', { class: 'swatch icon' }, f.icon), isPaint('feature', k), paint('feature', k), f.difficult ? `${f.label} (difficult terrain)` : f.label))),
    h('p', { class: 'hint' }, 'Right-drag erases the selected layer.'),

    h('div', { class: 'section-title' }, 'Map'),
    h('div', { class: 'row' },
      field('Width', h('input', { type: 'number', id: 'mapW', value: map.width, min: 4, max: 80 })),
      field('Height', h('input', { type: 'number', id: 'mapH', value: map.height, min: 4, max: 80 })),
      h('button', { class: 'btn', onclick: resizeMap }, 'Resize')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: newMap }, '✦ New'),
      h('button', { class: 'btn', onclick: clearTerrain }, 'Clear terrain'),
      h('button', { class: 'btn', onclick: centerMap }, 'Center')),

    h('div', { class: 'section-title' }, 'Background image'),
    ...bgControls(),

    h('div', { class: 'section-title' }, 'Saved maps'),
    ...savedMaps(),

    h('div', { class: 'section-title' }, 'Import / Export'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: exportPng }, '🖼 PNG'),
      h('button', { class: 'btn', onclick: exportJson }, '⬇ JSON'),
      h('button', { class: 'btn', onclick: importJson }, '⬆ JSON')),

    h('div', { class: 'section-title' }, 'View'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.settings.grid, onchange: e => { ui.settings.grid = e.target.checked; requestRender(); } }), 'Show grid'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.settings.coords, onchange: e => { ui.settings.coords = e.target.checked; requestRender(); } }), 'Show coordinates'),
  ];
  return out;
}

function bgControls() {
  const bg = store.state.map.bg;
  const upload = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    toast('Uploading…');
    try {
      const { fileId, w, h: ih } = await uploadImage(file);
      const nbg = { fileId, w, h: ih, opacity: 1, scale: 1, ox: 0, oy: 0 };
      const clear = await confirmDialog('Clear the painted terrain so the image shows through? (Walls and features are kept.)', 'Clear terrain');
      const m = store.state.map;
      // Match grid height to the image aspect ratio so squares stay square
      const height = Math.max(4, Math.round(m.width * ih / w));
      const cells = makeCells(m.width, height, m.cells);
      if (clear) for (const row of cells) for (const c of row) c.terrain = 'none';
      dispatch({ type: 'battle.setMap', map: { width: m.width, height, cells, bg: nbg } });
      toast('Background set — adjust grid width to match the image squares');
    } catch (e) { toast(e.message, true); }
  };
  if (!bg) return [h('button', { class: 'btn wide', onclick: upload }, '📁 Upload map image')];
  const set = patch => dispatch({ type: 'battle.setBg', bg: { ...store.state.map.bg, ...patch } });
  const fitCols = async () => {
    const n = parseInt(await promptDialog('Fit grid to image', 'How many squares wide is the image?', String(store.state.map.width)), 10);
    if (!n || n < 2) return;
    const b = store.state.map.bg;
    const height = Math.max(2, Math.round(n * b.h / b.w));
    dispatch({ type: 'battle.setMap', map: { width: n, height, cells: makeCells(n, height, store.state.map.cells), bg: { ...b, scale: 1, ox: 0, oy: 0 } } });
  };
  return [
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: upload }, 'Replace'),
      h('button', { class: 'btn', onclick: fitCols }, 'Fit grid'),
      h('button', { class: 'btn danger', onclick: () => dispatch({ type: 'battle.setBg', bg: null }) }, 'Remove')),
    field('Opacity', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: bg.opacity ?? 1, onchange: e => set({ opacity: +e.target.value }) })),
    field('Scale', h('input', { type: 'range', min: 0.5, max: 2, step: 0.01, value: bg.scale ?? 1, onchange: e => set({ scale: +e.target.value }) })),
    h('div', { class: 'row' },
      field('Offset X', h('input', { type: 'number', step: 0.05, value: bg.ox || 0, onchange: e => set({ ox: +e.target.value }) })),
      field('Offset Y', h('input', { type: 'number', step: 0.05, value: bg.oy || 0, onchange: e => set({ oy: +e.target.value }) }))),
  ];
}

function savedMaps() {
  if (!isDM()) return [h('p', { class: 'hint' }, 'Only the DM can save/load maps.')];
  const names = Object.keys(store.state.maps || {});
  return [
    ...names.map(n => h('div', { class: 'list-row' },
      h('span', { class: 'grow' }, n),
      h('button', { class: 'btn small', onclick: async () => { if (await confirmDialog(`Load "${n}"? The current map will be replaced.`, 'Load')) dispatch({ type: 'battle.loadMap', name: n }); } }, 'Load'),
      h('button', { class: 'icon-btn', title: 'Delete', onclick: async () => { if (await confirmDialog(`Delete saved map "${n}"?`, 'Delete', true)) dispatch({ type: 'battle.deleteMap', name: n }); } }, '🗑'))),
    names.length ? null : h('p', { class: 'hint' }, 'Prep encounters ahead of time and load them here.'),
    h('button', { class: 'btn wide', onclick: async () => {
      const name = await promptDialog('Save map', 'Name', `Map ${names.length + 1}`);
      if (!name) return;
      const withTokens = await confirmDialog('Include the non-player tokens currently on the map?', 'Include tokens');
      dispatch({ type: 'battle.saveMap', name: name.trim().slice(0, 60), withTokens });
      toast('Map saved');
    } }, '💾 Save current map'),
  ];
}

function resizeMap() {
  const w = Math.max(4, Math.min(80, parseInt(document.getElementById('mapW').value, 10) || 20));
  const hh = Math.max(4, Math.min(80, parseInt(document.getElementById('mapH').value, 10) || 20));
  const m = store.state.map;
  dispatch({ type: 'battle.setMap', map: { width: w, height: hh, cells: makeCells(w, hh, m.cells) } });
}

async function newMap() {
  if (!await confirmDialog('Start a blank map? Terrain, background and all tokens are cleared.', 'New map', true)) return;
  const m = store.state.map;
  dispatch({ type: 'battle.setMap', map: { width: m.width, height: m.height, cells: makeCells(m.width, m.height), bg: null }, tokens: {} });
}

async function clearTerrain() {
  if (!await confirmDialog('Reset all terrain, walls and features?', 'Clear', true)) return;
  const m = store.state.map;
  const cells = makeCells(m.width, m.height);
  if (m.bg) for (const row of cells) for (const c of row) c.terrain = 'none';
  dispatch({ type: 'battle.setMap', map: { width: m.width, height: m.height, cells } });
}

function exportJson() {
  const s = store.state;
  const tokens = Object.fromEntries(Object.entries(s.battle.tokens).filter(([, t]) => !t.charId));
  const blob = new Blob([JSON.stringify({ version: 2, map: s.map, tokens }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'battle-map.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJson() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let map, tokens = {};
    if (data.version === 2 && data.map) {
      map = data.map;
      tokens = data.tokens || {};
    } else if (Array.isArray(data.cells)) {
      // v1 format from the original combat map: tokens lived inside cells
      map = { width: data.width, height: data.height, cells: data.cells, bg: null };
      data.cells.forEach((row, r) => row.forEach((cell, c) => {
        if (!cell.token) return;
        const t = cell.token;
        const def = tokenDef(t.type);
        const id = 't-' + uid(8);
        tokens[id] = {
          id, type: t.type, name: t.name || def.label, col: c, row: r, size: 1, hp: t.hp ?? 10, maxHp: t.maxHp ?? 10, ac: 12, speed: 30,
          side: t.isPlayer ? 'party' : 'enemy', color: def.color, actions: parseActionText(def.actions || ''), initiative: t.initiative || 0, conditions: [],
        };
      }));
    } else throw new Error('Unrecognised map file');
    const keepPCs = Object.fromEntries(Object.entries(store.state.battle.tokens).filter(([, t]) => t.charId && t.col < map.width && t.row < map.height));
    dispatch({ type: 'battle.setMap', map, tokens: { ...tokens, ...keepPCs } });
    toast('Map imported');
  } catch (e) {
    toast('Import failed: ' + e.message, true);
  }
}

// ------------------------------------------------------------
// Tokens tab
// ------------------------------------------------------------

function tokensTab() {
  const s = store.state;
  const onMap = Object.values(s.battle.tokens);
  const out = [];

  out.push(h('div', { class: 'section-title' }, 'Party'));
  const chars = Object.values(s.party.chars);
  if (!chars.length) out.push(h('p', { class: 'hint' }, 'Import characters on the Party tab.'));
  for (const ch of chars) {
    const tok = onMap.find(t => t.charId === ch.id);
    const mine = isDM() || ch.player === store.me.name;
    out.push(h('div', { class: 'roster-row' },
      h('div', { class: 'dot', style: { background: ch.color } }, ch.avatar ? h('img', { src: ch.avatar, alt: '' }) : ch.name.slice(0, 2)),
      h('div', { class: 'grow' }, h('div', {}, ch.name), h('small', {}, `${ch.hp}/${ch.maxHp} HP · AC ${ch.ac}`)),
      tok ? h('button', { class: 'btn small', onclick: () => { ui.selectedId = tok.id; renderHotbar(); requestRender(); } }, 'Select')
        : mine ? h('button', { class: 'btn small primary', onclick: () => setTool({ mode: 'place', template: { charId: ch.id, name: ch.name } }) }, 'Place') : null));
  }

  if (isDM()) {
    out.push(h('div', { class: 'section-title' }, 'NPCs'));
    const npcs = Object.values(s.npcs);
    if (!npcs.length) out.push(h('p', { class: 'hint' }, 'Create NPCs in the Journal to spawn them here.'));
    for (const n of npcs) {
      out.push(h('div', { class: 'roster-row' },
        h('div', { class: 'dot', style: { background: n.color || '#2e6b8a' } }, n.portraitId ? h('img', { src: fileUrl(n.portraitId), alt: '' }) : n.name.slice(0, 2)),
        h('div', { class: 'grow' }, h('div', {}, n.name), h('small', {}, n.role || n.attitude || '')),
        h('button', { class: 'btn small', onclick: () => setTool({ mode: 'place', template: { npcId: n.id, name: n.name } }) }, 'Place')));
    }
  }

  if (canEdit()) {
    out.push(h('div', { class: 'section-title' }, 'Monsters'),
      isDM() ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: placeHidden, onchange: e => { placeHidden = e.target.checked; } }), 'Place hidden (only you see them)') : null,
      h('div', { class: 'grid-3' }, MONSTER_TOKENS.map(m =>
        toolBtn(m.label, h('div', { class: 'token-circle', style: { background: m.color } }, m.abbr),
          ui.tool.mode === 'place' && ui.tool.template.monster === m.type,
          () => setTool({ mode: 'place', template: { monster: m.type, name: m.label } }), `${m.label} — ${m.hp} HP, AC ${m.ac}`))));
  }

  if (onMap.length) {
    const monsters = onMap.filter(isMonster);
    const hiddenCount = monsters.filter(t => t.hidden).length;
    out.push(h('div', { class: 'section-title row-title' }, 'On the map',
      isDM() && monsters.length ? h('button', {
        class: 'btn tiny', onclick: () => setMonstersHidden(monsters, !hiddenCount),
        title: hiddenCount ? `Show all ${monsters.length} monster tokens to players` : 'Hide all monster tokens from players',
      }, hiddenCount ? `👁 Reveal monsters (${hiddenCount} hidden)` : '🙈 Hide monsters') : null));
    for (const t of onMap) {
      if (t.hidden && !isDM()) continue;
      const v = tokenView(s, t);
      out.push(h('div', { class: 'roster-row compact' + (ui.selectedId === t.id ? ' selected' : '') },
        h('div', { class: 'dot', style: { background: v.color } }, v.name.slice(0, 2)),
        h('div', { class: 'grow', onclick: () => { ui.selectedId = t.id; renderHotbar(); requestRender(); } },
          v.name, t.hidden ? h('span', { class: 'tag' }, 'hidden') : null, (isDM() || v.isPC || myToken(t)) ? h('small', {}, ` ${v.hp}/${v.maxHp}`) : null),
        (isDM() || canEdit() || myToken(t)) ? h('button', { class: 'icon-btn', title: 'Edit', onclick: () => openTokenEditor(t.id) }, '✎') : null));
    }
  }
  return out;
}

// Monsters: anything that isn't a PC, on the party's side, or run by a player
const isMonster = t => !t.charId && !t.owner && t.side !== 'party';

function setMonstersHidden(monsters, hidden) {
  const changed = monsters.filter(t => !!t.hidden !== hidden);
  for (const t of changed) dispatch({ type: 'battle.updateToken', id: t.id, patch: { hidden } });
  toast(`${changed.length} monster${changed.length === 1 ? '' : 's'} ${hidden ? 'hidden from' : 'revealed to'} players`);
}

export function placeTokenFromTemplate(tpl, c, r) {
  const s = store.state;
  const id = 't-' + uid(8);
  let token;
  if (tpl.charId) {
    const ch = s.party.chars[tpl.charId];
    if (!ch) return;
    if (Object.values(s.battle.tokens).some(t => t.charId === ch.id)) { toast(`${ch.name} is already on the map`, true); return; }
    const cls = (ch.classes?.[0]?.name || '').toLowerCase();
    token = { id, charId: ch.id, type: PLAYER_TOKENS.find(p => p.type === cls)?.type || 'fighter', col: c, row: r, size: 1, side: 'party' };
  } else if (tpl.npcId) {
    const n = s.npcs[tpl.npcId];
    if (!n) return;
    token = {
      id, npcId: n.id, type: 'npc', name: n.name, col: c, row: r, size: n.size || 1, color: n.color || '#2e6b8a', avatarFile: n.portraitId || null,
      hp: n.maxHp || 10, maxHp: n.maxHp || 10, ac: n.ac || 10, speed: n.speed || 30, initBonus: n.initBonus || 0,
      side: n.attitude === 'hostile' ? 'enemy' : n.attitude === 'ally' ? 'party' : 'neutral',
      actions: parseActionText(n.actions || ''), saves: n.saves || {}, conditions: [], hidden: placeHidden && isDM(),
    };
  } else {
    const m = MONSTER_TOKENS.find(x => x.type === tpl.monster) || MONSTER_TOKENS[0];
    const same = Object.values(s.battle.tokens).filter(t => t.type === m.type).length;
    token = {
      id, type: m.type, name: same ? `${m.label} ${same + 1}` : m.label, col: c, row: r, size: m.type === 'dragon' ? 2 : m.type === 'giant' || m.type === 'monstrosity' ? 2 : 1,
      color: m.color, hp: m.hp, maxHp: m.hp, ac: m.ac, speed: m.speed || 30, initBonus: 1, side: 'enemy',
      actions: parseActionText(m.actions), saves: {}, conditions: [], hidden: placeHidden && isDM(),
    };
    if (!isDM()) token.owner = store.me.name;
  }
  if (c + (token.size || 1) > s.map.width || r + (token.size || 1) > s.map.height) { toast("Doesn't fit there", true); return; }
  dispatch({ type: 'battle.addToken', token });
  ui.selectedId = id;
  renderHotbar();
}

// ------------------------------------------------------------
// Log tab
// ------------------------------------------------------------

const LOG_ICON = { attack: '⚔', heal: '✚', death: '☠', combat: '⏱', roll: '🎲', note: '✎', travel: '🥾' };

function logTab() {
  const entries = store.state.log.slice(-150);
  const input = h('input', { type: 'text', placeholder: 'Add a note to the log…', maxlength: 500 });
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    dispatch({ type: 'log.add', text });
    input.value = '';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  return [
    h('div', { class: 'log-feed' }, entries.map(logLine)),
    h('div', { class: 'row log-input' }, input, h('button', { class: 'btn', onclick: send }, 'Add')),
  ];
}

export function logLine(e) {
  return h('div', { class: 'log-line kind-' + e.kind },
    h('span', { class: 'ic' }, LOG_ICON[e.kind] || '•'),
    h('div', { class: 'grow' }, h('div', {}, e.text), h('small', {}, fmtTime(e.ts), e.kind === 'note' && e.by ? ` · ${e.by}` : '')));
}

// ------------------------------------------------------------
// Token editor
// ------------------------------------------------------------

export function openTokenEditor(id) {
  const s = store.state;
  const t = s.battle.tokens[id];
  if (!t) return;
  const v = tokenView(s, t);
  const pc = !!t.charId;
  const fullEdit = isDM() || canEdit() || myToken(t);
  if (!fullEdit) return;
  if (t.redacted) { toast("Only the DM can edit this creature's stats", true); return; }

  const inp = (type, value, attrs = {}) => h('input', { type, value: value ?? '', ...attrs });
  const name = inp('text', v.name, { disabled: pc });
  const hp = inp('number', v.hp, { min: 0 });
  const maxHp = inp('number', v.maxHp, { min: 1 });
  const temp = inp('number', v.tempHp || 0, { min: 0 });
  const ac = inp('number', v.ac ?? 10, { min: 0 });
  const speed = inp('number', v.speed ?? 30, { min: 0, step: 5, disabled: pc });
  const initB = inp('number', v.initBonus ?? 0, { disabled: pc });
  const init = inp('number', t.initiative ?? 0);
  const size = h('select', { disabled: pc }, [1, 2, 3, 4].map(n => h('option', { value: n, selected: (t.size || 1) === n }, ['Medium/Small', 'Large', 'Huge', 'Gargantuan'][n - 1])));
  const side = h('select', {}, ['party', 'neutral', 'enemy'].map(x => h('option', { value: x, selected: (t.side || (pc ? 'party' : 'enemy')) === x }, x[0].toUpperCase() + x.slice(1))));
  const type = h('select', { disabled: pc }, ALL_TOKENS.map(d => h('option', { value: d.type, selected: t.type === d.type }, d.label)));
  const color = inp('color', v.color || tokenDef(t.type).color);
  const art = h('select', { disabled: pc },
    h('option', { value: '', selected: !t.art }, 'Auto (match name)'), h('option', { value: 'none', selected: t.art === 'none' }, 'None'),
    Object.entries(MONSTER_ART).map(([slug, label]) => h('option', { value: slug, selected: t.art === slug }, label)));
  const hidden = h('input', { type: 'checkbox', checked: !!t.hidden });
  const owner = inp('text', t.owner || '', { placeholder: 'player name (optional)', disabled: pc });
  const saves = ABILITIES.map(k => inp('number', v.saves?.[k] ?? 0, { title: k.toUpperCase(), disabled: pc }));
  const actions = h('textarea', { rows: 6, disabled: pc, spellcheck: false }, actionsToText(v.actions));
  const conds = new Set(v.conditions);
  const condBox = h('div', { class: 'chips' }, CONDITIONS.map(c => {
    const chip = h('button', { class: 'chip' + (conds.has(c) ? ' on' : ''), type: 'button', onclick: () => { conds.has(c) ? conds.delete(c) : conds.add(c); chip.classList.toggle('on'); } }, c);
    return chip;
  }));

  const body = h('div', { class: 'form-grid' },
    field('Name', name), field('Side', side),
    field('HP', hp), field('Max HP', maxHp), field('Temp HP', temp), field('AC', ac),
    field('Speed', speed), field('Initiative bonus', initB), field('Initiative', init), field('Size', size),
    field('Icon', type), field('Color', color),
    pc ? null : field('Hover portrait', art),
    h('div', { class: 'span2' }, field('Conditions', condBox)),
    pc ? h('p', { class: 'span2 hint' }, 'Stats, saves and actions come from the character sheet (Party tab).') : h('div', { class: 'span2' },
      h('div', { class: 'section-title' }, 'Saving throw bonuses'),
      h('div', { class: 'saves-row' }, ABILITIES.map((k, i) => h('label', {}, h('small', {}, k.toUpperCase()), saves[i]))),
      field('Actions', actions, 'One per line:  Name | melee/ranged/spell/save:dex/heal/auto | to-hit or DC | damage type | range ft | radius ft | flags (bonus, slot:N, targets:N)')),
    isDM() && !pc ? field('Controlled by', owner) : null,
    isDM() ? h('label', { class: 'check span2' }, hidden, 'Hidden from players') : null,
  );

  openModal({
    title: `Edit ${v.name}`,
    body,
    wide: true,
    actions: [
      { label: 'Delete', class: 'danger', onClick: () => { dispatch({ type: 'battle.removeToken', id }); ui.selectedId = null; renderHotbar(); } },
      !pc && (isDM() || canEdit()) ? { label: 'Duplicate', onClick: () => duplicate(t) } : null,
      { label: 'Cancel' },
      {
        label: 'Save', class: 'primary', onClick: () => {
          const patch = {
            hp: Math.max(0, +hp.value | 0), maxHp: Math.max(1, +maxHp.value | 0), tempHp: Math.max(0, +temp.value | 0), ac: +ac.value | 0,
            conditions: [...conds], side: side.value, color: color.value,
          };
          if (!pc) Object.assign(patch, {
            name: name.value.trim() || 'Token', speed: +speed.value | 0, initBonus: +initB.value | 0, size: +size.value, type: type.value, art: art.value || null,
            actions: parseActionText(actions.value), saves: Object.fromEntries(ABILITIES.map((k, i) => [k, +saves[i].value | 0])),
          });
          if (isDM() && !pc) patch.owner = owner.value.trim() || null;
          if (isDM() && hidden.checked !== !!t.hidden) patch.hidden = hidden.checked;
          dispatch({ type: 'battle.updateToken', id, patch });
          if ((+init.value | 0) !== (t.initiative ?? 0)) dispatch({ type: 'battle.setInit', id, initiative: +init.value | 0 });
        },
      },
    ].filter(Boolean),
  });
}

function duplicate(t) {
  const m = store.state.map;
  for (let d = 1; d < 6; d++) {
    for (const [dc, dr] of [[d, 0], [0, d], [-d, 0], [0, -d], [d, d]]) {
      const c = t.col + dc, r = t.row + dr;
      if (c < 0 || r < 0 || c >= m.width || r >= m.height) continue;
      if (Object.values(store.state.battle.tokens).some(o => o.col === c && o.row === r)) continue;
      const base = t.name.replace(/\s+\d+$/, '');
      const n = Object.values(store.state.battle.tokens).filter(o => o.name?.startsWith(base)).length + 1;
      dispatch({ type: 'battle.addToken', token: { ...JSON.parse(JSON.stringify(t)), id: 't-' + uid(8), col: c, row: r, name: `${base} ${n}`, hp: t.maxHp, conditions: [] } });
      return;
    }
  }
  toast('No free space nearby', true);
}

// ------------------------------------------------------------
// Start combat
// ------------------------------------------------------------

export function openStartCombat() {
  const s = store.state;
  const toks = Object.values(s.battle.tokens).map(t => tokenView(s, t)).filter(v => !v.conditions.includes('dead'));
  if (!toks.length) { toast('Place some tokens first', true); return; }
  const name = h('input', { type: 'text', value: `Encounter ${s.encounters.length + 1}` });
  const rows = toks.map(v => {
    const d = rollD20();
    const cb = h('input', { type: 'checkbox', checked: true });
    const init = h('input', { type: 'number', value: d.value + (v.initBonus || 0), class: 'init-input' });
    return { v, cb, init, el: h('label', { class: 'list-row' }, cb, h('span', { class: 'grow' }, v.name, v.hidden ? h('span', { class: 'tag' }, 'hidden') : null), h('small', {}, `d20 ${d.value} ${v.initBonus >= 0 ? '+' : ''}${v.initBonus || 0} =`), init) };
  });
  openModal({
    title: '⚔ Roll for initiative!',
    body: h('div', {}, field('Encounter name', name), h('div', { class: 'section-title' }, 'Combatants (rolled automatically — edit freely)'), h('div', { class: 'list' }, rows.map(r => r.el))),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Start combat', class: 'primary', onClick: () => {
          const order = rows.filter(r => r.cb.checked).map(r => ({ id: r.v.id, init: +r.init.value | 0 }));
          if (!order.length) { toast('Pick at least one combatant', true); return false; }
          dispatch({ type: 'battle.combatStart', order, encId: 'enc-' + uid(8), name: name.value.trim() || 'Encounter' });
        },
      },
    ],
  });
}

