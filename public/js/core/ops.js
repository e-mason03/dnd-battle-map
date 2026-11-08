// ============================================================
// Shared game-state reducer.
//
// Imported by BOTH the Cloudflare Worker (authoritative copy) and the
// browser (optimistic copy), so every change to the campaign goes through
// applyOp() and stays deterministic: anything random (dice) is rolled by
// the client *before* the op is created and travels inside the op.
// ============================================================

import { hexKey, parseHexKey, hexNeighbors } from './hexmath.js';

// ------------------------------------------------------------
// Initial state
// ------------------------------------------------------------

export function makeCells(w, h, old) {
  const cells = [];
  for (let r = 0; r < h; r++) {
    cells[r] = [];
    for (let c = 0; c < w; c++) {
      const o = old?.[r]?.[c];
      cells[r][c] = o
        ? { terrain: o.terrain || 'grass', elevation: o.elevation || 0, feature: o.feature || null }
        : { terrain: 'grass', elevation: 0, feature: null };
    }
  }
  return cells;
}

export function initialState() {
  return {
    meta: { name: 'New Campaign', settings: { playersCanEdit: false } },
    map: { width: 24, height: 16, cells: makeCells(24, 16), bg: null },
    battle: { tokens: {}, combat: emptyCombat() },
    maps: {},
    hex: {
      cols: 18, rows: 12, orientation: 'flat', size: 46, offsetX: 0, offsetY: 0,
      bg: null, fog: true, terrainAlpha: 1, milesPerHex: 6,
      hexes: {}, party: null, day: 1,
    },
    party: { chars: {}, items: [] },
    npcs: {},
    log: [],
    encounters: [],
    adventure: [],
    stats: { actors: {}, dice: {}, party: { encounters: 0, rounds: 0, hexes: 0, days: 0, kills: 0, downs: 0 } },
  };
}

export const SECTIONS = Object.keys(initialState());

function emptyCombat() {
  return { active: false, round: 0, turn: 0, order: [], encId: null, turnState: {} };
}

const LOG_CAP = 600;
const COVER_NOTE = { half: 'half cover', three: '¾ cover' };
const ADVENTURE_CAP = 1500;

// ------------------------------------------------------------
// Creature helpers — PC tokens read their numbers from the party sheet
// ------------------------------------------------------------

export function tokenView(state, tok) {
  const ch = tok.charId ? state.party.chars[tok.charId] : null;
  if (!ch) return { ...tok, conditions: tok.conditions || [], isPC: false };
  return {
    ...tok,
    name: ch.name, hp: ch.hp, maxHp: ch.maxHp, tempHp: ch.tempHp || 0, ac: ch.ac,
    speed: ch.speed, initBonus: ch.initBonus, saves: ch.saves || {}, actions: ch.actions || [],
    avatar: ch.avatar, color: ch.color || tok.color, conditions: ch.conditions || [],
    owner: ch.player, isPC: true,
  };
}

// Writable record that owns a creature's hp/conditions
function creatureRecord(state, tok) {
  return (tok.charId && state.party.chars[tok.charId]) || tok;
}

export function ownsToken(state, user, tok) {
  if (!tok) return false;
  if (user.role === 'dm') return true;
  if (tok.charId) return state.party.chars[tok.charId]?.player === user.name;
  return !!tok.owner && tok.owner === user.name;
}

function statKeyFor(tok) {
  return tok.charId ? 'pc:' + tok.charId : 'npc:' + (tok.name || 'Unknown').toLowerCase();
}

function actorStats(state, key, name, isPC) {
  const a = state.stats.actors[key] ||= {
    name, isPC: !!isPC, attacks: 0, hits: 0, crits: 0, fumbles: 0, dmgDealt: 0, dmgTaken: 0,
    healing: 0, kills: 0, downs: 0, spells: 0, maxHit: 0, maxHitDesc: '',
  };
  a.name = name;
  return a;
}

function diceStats(state, user) {
  return state.stats.dice[user || '?'] ||= { d20s: 0, d20Sum: 0, nat20: 0, nat1: 0, dice: 0 };
}

function recordD20(state, user, values) {
  const d = diceStats(state, user);
  for (const v of values) {
    d.d20s++; d.d20Sum += v; d.dice++;
    if (v === 20) d.nat20++;
    if (v === 1) d.nat1++;
  }
}

function addCondition(rec, name) {
  rec.conditions ||= [];
  if (!rec.conditions.includes(name)) rec.conditions.push(name);
}
function removeCondition(rec, name) {
  if (rec.conditions) rec.conditions = rec.conditions.filter(c => c !== name);
}

// Applies damage; returns what actually happened
function damageCreature(state, tok, amount, crit) {
  const rec = creatureRecord(state, tok);
  const isPC = !!tok.charId;
  const before = rec.hp ?? 0;
  let left = Math.max(0, amount | 0);
  const temp = rec.tempHp || 0;
  const fromTemp = Math.min(temp, left);
  rec.tempHp = temp - fromTemp;
  left -= fromTemp;
  const fromHp = Math.min(before, left);
  rec.hp = before - fromHp;
  const res = { dealt: fromTemp + fromHp, downed: false, killed: false, deathFail: 0 };

  if (isPC) {
    if (before > 0 && rec.hp === 0) {
      // Massive damage: leftover ≥ max HP is instant death
      if (left - fromHp >= (rec.maxHp || 1)) { addCondition(rec, 'dead'); res.killed = true; }
      else { addCondition(rec, 'unconscious'); res.downed = true; }
    } else if (before === 0 && amount > 0) {
      rec.deathSaves ||= { success: 0, fail: 0 };
      res.deathFail = crit ? 2 : 1;
      rec.deathSaves.fail = Math.min(3, rec.deathSaves.fail + res.deathFail);
      if (rec.deathSaves.fail >= 3) { addCondition(rec, 'dead'); res.killed = true; }
    }
  } else if (before > 0 && rec.hp === 0) {
    addCondition(rec, 'dead');
    res.killed = true;
  }
  return res;
}

function healCreature(state, tok, amount) {
  const rec = creatureRecord(state, tok);
  if ((rec.conditions || []).includes('dead')) return 0;
  const before = rec.hp ?? 0;
  rec.hp = Math.min(rec.maxHp || before + amount, before + Math.max(0, amount | 0));
  if (before === 0 && rec.hp > 0) {
    removeCondition(rec, 'unconscious');
    if (rec.deathSaves) rec.deathSaves = { success: 0, fail: 0 };
  }
  return rec.hp - before;
}

// ------------------------------------------------------------
// Logs
// ------------------------------------------------------------

// Decides hit / save / damage from the raw dice in a result, using the
// target's real AC and save bonuses. Runs wherever the full numbers live
// (the room, or the DM's browser) and writes the outcome back into `r`.
const COVER_AC = { half: 2, three: 5 };

// The one place the attack rule lives: nat 20 always hits, nat 1 always misses
const attackHits = (attack, ac) => attack.value === 20 || (attack.value !== 1 && attack.total >= ac);

// Hit / miss for a player's attack roll, without revealing the AC. Used by the
// room to answer a player's roll window before damage is rolled.
export function checkAttack(state, r) {
  const t = state.battle.tokens[r.targetId];
  const tv = t ? tokenView(state, t) : null;
  return { hit: attackHits(r.attack, (tv?.ac ?? 10) + (COVER_AC[r.cover] || 0)), crit: r.attack.value === 20 };
}

function resolveOutcome(r, a, tv) {
  const cover = COVER_AC[r.cover] || 0;
  if (r.attack) {
    r.ac = (tv?.ac ?? 10) + cover;
    r.crit = r.attack.value === 20;
    r.hit = attackHits(r.attack, r.ac);
    r.damage = r.hit ? (r.dmgRoll ?? r.damage ?? 0) : 0;
  } else if (r.save) {
    const bonus = (tv?.saves?.[r.save.ability] ?? 0) + (r.save.ability === 'dex' ? cover : 0);
    r.save.bonus = bonus;
    r.save.total = r.save.d20 + bonus;
    r.save.success = r.save.total >= r.save.dc;
    const full = r.dmgRoll ?? r.damage ?? 0;
    r.damage = r.save.success ? (a.half !== false ? Math.floor(full / 2) : 0) : full;
    r.hit = !r.save.success;
  } else if (a.kind === 'auto') {
    r.hit = true;
    r.damage = r.dmgRoll ?? r.damage ?? 0;
  }
}

function pushLog(state, op, entry) {
  const n = (op._logN = (op._logN || 0) + 1);
  state.log.push({
    id: `${op.id}:${n}`, ts: op.ts, by: op.by,
    enc: state.battle.combat.active ? state.battle.combat.encId : null,
    ...entry,
  });
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

function pushAdventure(state, op, entry) {
  const n = (op._advN = (op._advN || 0) + 1);
  state.adventure.push({ id: `${op.id}:a${n}`, ts: op.ts, by: op.by, kind: 'event', ...entry });
  if (state.adventure.length > ADVENTURE_CAP) state.adventure.splice(0, state.adventure.length - ADVENTURE_CAP);
}

function currentEncounter(state) {
  const c = state.battle.combat;
  return c.active ? state.encounters.find(e => e.id === c.encId) : null;
}

// Item categories. Characters default to the first four, the party stash
// to the last three, but an item keeps its category wherever it's carried.
export const ITEM_CATS = ['armor', 'weapon', 'consumable', 'gear', 'quest', 'treasure', 'misc'];

function bagOf(s, owner) {
  if (owner === 'party') return (s.party.items ||= []);
  const ch = s.party.chars[owner];
  return ch ? (ch.inventory ||= []) : null;
}

// ------------------------------------------------------------
// Which sections each op touches (used by the server to persist)
// ------------------------------------------------------------

const TOUCHES = {
  'battle.paint': ['map'], 'battle.setMap': ['map', 'battle'], 'battle.setBg': ['map'],
  'battle.addToken': ['battle'], 'battle.updateToken': ['battle', 'party'], 'battle.removeToken': ['battle'],
  'battle.moveToken': ['battle'], 'battle.setTokens': ['battle'],
  'battle.action': ['battle', 'party', 'log', 'stats', 'encounters'],
  'battle.combatStart': ['battle', 'log', 'encounters', 'stats'],
  'battle.combatNext': ['battle', 'log', 'stats', 'encounters'], 'battle.combatPrev': ['battle'],
  'battle.combatEnd': ['battle', 'log', 'encounters', 'adventure'],
  'battle.setInit': ['battle'], 'battle.turnState': ['battle'],
  'battle.saveMap': ['maps'], 'battle.loadMap': ['map', 'battle'], 'battle.deleteMap': ['maps'],
  'hex.paint': ['hex'], 'hex.setMany': ['hex'], 'hex.setHex': ['hex'], 'hex.config': ['hex'],
  'hex.moveParty': ['hex', 'stats', 'adventure', 'log'], 'hex.advanceDay': ['hex', 'stats', 'adventure'],
  'party.upsertChar': ['party', 'adventure'], 'party.updateChar': ['party'], 'party.hp': ['party', 'log'],
  'party.slot': ['party'], 'party.rest': ['party', 'log'], 'party.removeChar': ['party', 'battle'],
  'party.claim': ['party'], 'party.item': ['party'], 'party.itemRemove': ['party'], 'party.itemMove': ['party'],
  'npc.upsert': ['npcs', 'adventure'], 'npc.remove': ['npcs'],
  'log.add': ['log'], 'dice.roll': ['log', 'stats'],
  'adventure.add': ['adventure', 'stats'], 'adventure.update': ['adventure'], 'adventure.remove': ['adventure', 'stats'],
  'encounter.update': ['encounters'], 'encounter.remove': ['encounters'],
  'room.settings': ['meta'],
};

export const touchedSections = op => TOUCHES[op.type] || [];

// ------------------------------------------------------------
// Permissions
// ------------------------------------------------------------

const DM_ONLY = new Set([
  'battle.setTokens', 'battle.combatStart', 'battle.combatEnd', 'battle.combatPrev', 'battle.saveMap', 'battle.loadMap',
  'battle.deleteMap', 'hex.config', 'hex.advanceDay', 'hex.moveParty', 'hex.setMany', 'npc.upsert', 'npc.remove',
  'room.settings', 'encounter.update', 'encounter.remove', 'party.removeChar',
]);
const EDITOR_OPS = new Set(['battle.paint', 'battle.setMap', 'battle.setBg', 'hex.paint', 'hex.setHex']);
const OPEN_OPS = new Set(['log.add', 'dice.roll', 'adventure.add']);

export function canApply(op, user, state) {
  if (!op || typeof op.type !== 'string' || !TOUCHES[op.type]) return 'Unknown operation';
  if (user.role === 'dm') return true;
  if (DM_ONLY.has(op.type)) return 'Only the DM can do that';
  if (OPEN_OPS.has(op.type)) return true;
  if (EDITOR_OPS.has(op.type)) return state.meta.settings.playersCanEdit || 'The DM has locked map editing';

  const tokens = state.battle.tokens;
  const chars = state.party.chars;
  const ownsChar = id => chars[id]?.player === user.name;
  const editAll = state.meta.settings.playersCanEdit;

  switch (op.type) {
    case 'battle.addToken':
      if (op.token?.hidden) return 'Only the DM can add hidden tokens';
      return (op.token?.charId ? ownsChar(op.token.charId) : editAll) || 'You can only place your own character';
    case 'battle.updateToken':
      if (op.patch && 'hidden' in op.patch) return 'Only the DM can hide tokens';
      return ownsToken(state, user, tokens[op.id]) || editAll || 'Not your token';
    case 'battle.removeToken':
    case 'battle.moveToken':
    case 'battle.setInit':
    case 'battle.turnState':
      return ownsToken(state, user, tokens[op.id]) || editAll || 'Not your token';
    case 'battle.action':
      return ownsToken(state, user, tokens[op.actorId]) || 'Not your token';
    case 'battle.combatNext': {
      const c = state.battle.combat;
      return ownsToken(state, user, tokens[c.order[c.turn]?.id]) || 'It is not your turn';
    }
    case 'party.upsertChar': {
      const existing = chars[op.char?.id];
      if (existing && existing.player !== user.name) return 'Not your character';
      op.char.player = user.name;
      return true;
    }
    case 'party.claim':
      return (!chars[op.id]?.player || ownsChar(op.id)) || 'Already claimed';
    case 'party.updateChar':
      if (op.patch && 'player' in op.patch) return 'Only the DM can reassign characters';
      return ownsChar(op.id) || 'Not your character';
    case 'party.hp':
    case 'party.slot':
    case 'party.rest':
      return ownsChar(op.id) || 'Not your character';
    // The shared party stash is open to everyone; a character's bag only to its player
    case 'party.item':
    case 'party.itemRemove':
      return op.owner === 'party' || ownsChar(op.owner) || 'Not your character';
    case 'party.itemMove':
      return op.from === 'party' || ownsChar(op.from) || 'Not your character';
    case 'adventure.update':
    case 'adventure.remove': {
      const e = state.adventure.find(x => x.id === op.id);
      return (e && e.by === user.name) || 'You can only edit your own entries';
    }
  }
  return 'Not allowed';
}

// ------------------------------------------------------------
// Reducer
// ------------------------------------------------------------

export function applyOp(state, op) {
  const fn = REDUCERS[op.type];
  if (!fn) throw new Error('Unknown op ' + op.type);
  fn(state, op);
  delete op._logN;
  delete op._advN;
  return touchedSections(op);
}

const REDUCERS = {
  // ---------------- Battle map ----------------
  'battle.paint'(s, op) {
    for (const p of op.cells || []) {
      const cell = s.map.cells[p.r]?.[p.c];
      if (!cell) continue;
      if ('terrain' in p) cell.terrain = p.terrain;
      if ('elevation' in p) cell.elevation = p.elevation;
      if ('feature' in p) cell.feature = p.feature;
    }
  },

  'battle.setMap'(s, op) {
    const m = op.map;
    s.map = {
      width: m.width, height: m.height,
      cells: makeCells(m.width, m.height, m.cells),
      bg: m.bg === undefined ? s.map.bg : m.bg,
    };
    if (op.tokens) s.battle.tokens = op.tokens;
    for (const t of Object.values(s.battle.tokens)) {
      if (t.col >= m.width || t.row >= m.height) delete s.battle.tokens[t.id];
    }
  },

  'battle.setBg'(s, op) { s.map.bg = op.bg; },

  'battle.addToken'(s, op) { s.battle.tokens[op.token.id] = op.token; },

  'battle.updateToken'(s, op) {
    const t = s.battle.tokens[op.id];
    if (!t) return;
    const patch = { ...op.patch };
    // HP / conditions on PC tokens belong to the character sheet
    const ch = t.charId && s.party.chars[t.charId];
    if (ch) {
      for (const k of ['hp', 'maxHp', 'tempHp', 'ac', 'conditions']) {
        if (k in patch) { ch[k] = patch[k]; delete patch[k]; }
      }
    }
    Object.assign(t, patch);
  },

  // Full-replace of specific tokens (server → players after redaction)
  'battle.setTokens'(s, op) {
    for (const [id, t] of Object.entries(op.tokens || {})) {
      if (t) s.battle.tokens[id] = t; else delete s.battle.tokens[id];
    }
  },

  'battle.removeToken'(s, op) {
    delete s.battle.tokens[op.id];
    const c = s.battle.combat;
    const idx = c.order.findIndex(o => o.id === op.id);
    if (idx >= 0) {
      c.order.splice(idx, 1);
      if (idx < c.turn) c.turn--;
      if (c.turn >= c.order.length) c.turn = 0;
    }
  },

  'battle.moveToken'(s, op) {
    const t = s.battle.tokens[op.id];
    if (!t || !op.path?.length) return;
    const [col, row] = op.path[op.path.length - 1];
    t.col = col; t.row = row;
    const c = s.battle.combat;
    if (c.active && op.cost) {
      const ts = c.turnState[op.id] ||= {};
      ts.moved = (ts.moved || 0) + op.cost;
    }
  },

  'battle.turnState'(s, op) {
    const c = s.battle.combat;
    c.turnState[op.id] = { ...(c.turnState[op.id] || {}), ...op.patch };
  },

  'battle.action'(s, op) {
    // Players receive an already-resolved copy just to play the animation;
    // the real state changes reach them in a redacted 'patch' message.
    if (op.fx) return;
    const b = s.battle;
    const actor = b.tokens[op.actorId];
    const av = actor ? tokenView(s, actor) : null;
    const actorName = av?.name || op.actorName || 'Someone';
    const a = op.action || {};
    const aKey = actor ? statKeyFor(actor) : 'npc:' + actorName.toLowerCase();
    const aStats = actorStats(s, aKey, actorName, !!actor?.charId);
    const enc = currentEncounter(s);

    if (a.slot > 0 && actor?.charId) {
      const ch = s.party.chars[actor.charId];
      const slot = a.pact ? ch?.pact : ch?.slots?.find(x => x.level === a.slot);
      if (slot && slot.used < slot.max) slot.used++;
    }
    if (a.slot > 0 || a.kind === 'spell' || a.kind === 'save' || a.isSpell) aStats.spells++;
    if (actor && b.combat.active) {
      const ts = b.combat.turnState[actor.id] ||= {};
      ts[a.cost === 'bonus' ? 'bonus' : 'action'] = true;
    }

    const parts = [];
    for (const r of op.results || []) {
      const tgt = b.tokens[r.targetId];
      const tv = tgt ? tokenView(s, tgt) : null;
      const tName = tv?.name || r.targetName || 'target';

      if (a.kind === 'heal') {
        const healed = tgt ? healCreature(s, tgt, r.heal) : r.heal;
        aStats.healing += healed;
        parts.push(`${tName} +${healed} HP`);
        continue;
      }

      resolveOutcome(r, a, tv);
      let desc = tName;
      if (r.attack) {
        aStats.attacks++;
        recordD20(s, op.by, r.attack.rolls);
        if (r.crit) aStats.crits++;
        if (r.attack.value === 1) aStats.fumbles++;
        if (r.hit) aStats.hits++;
        // Monster AC stays out of the log — players can read it
        const vs = tgt && statsVisibleToPlayers(tgt) ? ` vs AC ${r.ac}` : '';
        desc += ` (${r.attack.total}${vs}${r.cover ? `, ${COVER_NOTE[r.cover]}` : ''}: ${r.crit ? 'CRIT' : r.hit ? 'hit' : 'miss'})`;
      } else if (r.save) {
        desc += ` (${r.save.ability.toUpperCase()} save ${r.save.total} vs DC ${r.save.dc}${r.cover ? `, ${COVER_NOTE[r.cover]}` : ''}: ${r.save.success ? 'saved' : 'failed'})`;
      }

      if (r.damage > 0 && tgt) {
        const res = damageCreature(s, tgt, r.damage, r.crit);
        const tKey = statKeyFor(tgt);
        actorStats(s, tKey, tName, !!tgt.charId).dmgTaken += res.dealt;
        aStats.dmgDealt += res.dealt;
        if (r.damage > aStats.maxHit) {
          aStats.maxHit = r.damage;
          aStats.maxHitDesc = `${a.name} → ${tName}`;
        }
        desc += ` — ${r.damage} ${a.dmgType || ''}`.trimEnd();
        if (enc) enc.damage[actorName] = (enc.damage[actorName] || 0) + res.dealt;
        if (res.downed) {
          actorStats(s, tKey, tName, true).downs++;
          s.stats.party.downs++;
          desc += ' — DOWNED';
          pushLog(s, op, { kind: 'death', text: `${tName} falls unconscious!` });
        }
        if (res.killed) {
          aStats.kills++;
          if (!tgt.charId) s.stats.party.kills++;
          desc += ' — SLAIN';
          if (enc) enc.kills.push({ by: actorName, target: tName });
          pushLog(s, op, { kind: 'death', text: `${tName} was slain by ${actorName}.` });
          if (tgt.charId) {
            pushAdventure(s, op, { icon: 'skull', title: `${tName} has died`, text: `Slain by ${actorName}${enc ? ' during ' + enc.name : ''}.` });
          }
        }
        if (res.deathFail) desc += ` (+${res.deathFail} death save failure)`;
      } else if (r.damage > 0) {
        desc += ` — ${r.damage} ${a.dmgType || ''}`.trimEnd();
      }
      parts.push(desc);
    }

    const verb = a.kind === 'heal' ? 'heals with' : a.kind === 'save' ? 'casts' : 'uses';
    pushLog(s, op, {
      kind: a.kind === 'heal' ? 'heal' : 'attack',
      actor: actorName,
      text: `${actorName} ${verb} ${a.name}${parts.length ? ': ' + parts.join('; ') : ''}`,
    });
  },

  'battle.setInit'(s, op) {
    const c = s.battle.combat;
    const t = s.battle.tokens[op.id];
    if (t) t.initiative = op.initiative;
    const cur = c.order[c.turn]?.id;
    const o = c.order.find(x => x.id === op.id);
    if (o) o.init = op.initiative;
    else if (c.active && t) c.order.push({ id: op.id, init: op.initiative });
    c.order.sort((a, b) => b.init - a.init);
    const idx = c.order.findIndex(x => x.id === cur);
    if (idx >= 0) c.turn = idx;
  },

  'battle.combatStart'(s, op) {
    const order = [...(op.order || [])].sort((a, b) => b.init - a.init);
    for (const o of order) if (s.battle.tokens[o.id]) s.battle.tokens[o.id].initiative = o.init;
    s.battle.combat = { active: true, round: 1, turn: 0, order, encId: op.encId, turnState: {} };
    const participants = order.map(o => {
      const t = s.battle.tokens[o.id];
      return t ? { name: tokenView(s, t).name, pc: !!t.charId } : null;
    }).filter(Boolean);
    s.encounters.push({
      id: op.encId, name: op.name || `Encounter ${s.encounters.length + 1}`,
      start: op.ts, end: null, rounds: 1, participants, damage: {}, kills: [], notes: '',
    });
    s.stats.party.encounters++;
    s.stats.party.rounds++;
    pushLog(s, op, { kind: 'combat', text: `⚔ Combat begins: ${op.name || 'Encounter'} — Round 1` });
  },

  'battle.combatNext'(s, op) {
    const c = s.battle.combat;
    if (!c.active || !c.order.length) return;
    const prev = c.order[c.turn]?.id;
    if (prev) delete c.turnState[prev];
    // Advance, skipping the dead (and tokens removed from the map)
    for (let guard = 0; guard < c.order.length; guard++) {
      c.turn++;
      if (c.turn >= c.order.length) {
        c.turn = 0;
        c.round++;
        s.stats.party.rounds++;
        const enc = currentEncounter(s);
        if (enc) enc.rounds = c.round;
        pushLog(s, op, { kind: 'combat', text: `Round ${c.round}` });
      }
      const t = s.battle.tokens[c.order[c.turn]?.id];
      if (t && !tokenView(s, t).conditions.includes('dead')) break;
    }
    const t = s.battle.tokens[c.order[c.turn]?.id];
    if (t) delete c.turnState[t.id];
  },

  'battle.combatPrev'(s) {
    const c = s.battle.combat;
    if (!c.active || !c.order.length) return;
    if (c.turn === 0) {
      if (c.round > 1) { c.round--; c.turn = c.order.length - 1; }
    } else c.turn--;
  },

  'battle.combatEnd'(s, op) {
    const c = s.battle.combat;
    if (!c.active) return;
    const enc = currentEncounter(s);
    if (enc) {
      enc.end = op.ts;
      enc.rounds = c.round;
      const foes = enc.kills.filter(k => !enc.participants.find(p => p.name === k.target && p.pc));
      pushAdventure(s, op, {
        icon: 'swords', title: `${enc.name} ended`,
        text: `${c.round} round${c.round === 1 ? '' : 's'}` + (foes.length ? `, ${foes.length} foe${foes.length === 1 ? '' : 's'} defeated` : '') + '.',
      });
    }
    pushLog(s, op, { kind: 'combat', text: `Combat ends after ${c.round} round${c.round === 1 ? '' : 's'}.` });
    s.battle.combat = emptyCombat();
  },

  'battle.saveMap'(s, op) {
    s.maps[op.name] = {
      width: s.map.width, height: s.map.height, cells: s.map.cells, bg: s.map.bg,
      tokens: op.withTokens ? s.battle.tokens : null, saved: op.ts,
    };
  },

  'battle.loadMap'(s, op) {
    const m = s.maps[op.name];
    if (!m) return;
    REDUCERS['battle.setMap'](s, { map: m, tokens: m.tokens ? JSON.parse(JSON.stringify(m.tokens)) : undefined });
  },

  'battle.deleteMap'(s, op) { delete s.maps[op.name]; },

  // ---------------- Hexcrawl ----------------
  'hex.paint'(s, op) {
    for (const p of op.hexes || []) {
      const h = { ...(s.hex.hexes[p.k] || {}) };
      for (const [k, v] of Object.entries(p.patch || {})) {
        if (v === null || v === '') delete h[k]; else h[k] = v;
      }
      if (Object.keys(h).length) s.hex.hexes[p.k] = h; else delete s.hex.hexes[p.k];
    }
  },

  // Full-replace of specific hexes (server → players after redaction)
  'hex.setMany'(s, op) {
    for (const [k, v] of Object.entries(op.hexes || {})) {
      if (v) s.hex.hexes[k] = v; else delete s.hex.hexes[k];
    }
    if ('party' in op) s.hex.party = op.party;
  },

  'hex.setHex'(s, op) {
    if (op.data && Object.keys(op.data).length) s.hex.hexes[op.k] = op.data;
    else delete s.hex.hexes[op.k];
  },

  'hex.config'(s, op) { Object.assign(s.hex, op.patch); },

  'hex.moveParty'(s, op) {
    const from = s.hex.party;
    const [c, r] = op.to;
    s.hex.party = [c, r];
    for (const [nc, nr] of [[c, r], ...hexNeighbors(c, r, s.hex.orientation)]) {
      if (nc < 0 || nr < 0 || nc >= s.hex.cols || nr >= s.hex.rows) continue;
      const k = hexKey(nc, nr);
      s.hex.hexes[k] = { ...(s.hex.hexes[k] || {}), revealed: true };
    }
    if (from && op.dist) {
      s.stats.party.hexes += op.dist;
      const dest = s.hex.hexes[hexKey(c, r)] || {};
      const where = dest.label || op.terrainLabel || 'the wilds';
      const text = `The party travels ${op.dist} hex${op.dist === 1 ? '' : 'es'} (${op.dist * (s.hex.milesPerHex || 6)} mi) to ${where}.`;
      pushAdventure(s, op, { icon: 'boot', title: `Day ${s.hex.day}: Travel`, text });
    }
  },

  'hex.advanceDay'(s, op) {
    const n = Math.max(1, op.n | 0);
    s.hex.day += n;
    s.stats.party.days += n;
    pushAdventure(s, op, { icon: 'sun', title: `Day ${s.hex.day} dawns`, text: op.note || '' });
  },

  // ---------------- Party ----------------
  'party.upsertChar'(s, op) {
    const prev = s.party.chars[op.char.id];
    const ch = { ...op.char };
    if (prev && op.keepLive) {
      // Re-imports keep the table's live tracking (HP, slots used, conditions)
      ch.hp = Math.min(prev.hp, ch.maxHp);
      ch.tempHp = prev.tempHp;
      ch.conditions = prev.conditions;
      ch.deathSaves = prev.deathSaves;
      ch.player = prev.player ?? ch.player;
      ch.color = prev.color || ch.color;
      // Imported gear is replaced; items added at the table stay
      ch.inventory = [...(ch.inventory || []), ...(prev.inventory || []).filter(it => !it.ddb)];
    }
    if (prev && !('inventory' in op.char)) ch.inventory = prev.inventory;
    s.party.chars[ch.id] = ch;
    if (!prev) {
      pushAdventure(s, op, { icon: 'user', title: `${ch.name} joins the party`, text: describeChar(ch) });
    } else if ((ch.level || 0) > (prev.level || 0)) {
      pushAdventure(s, op, { icon: 'star', title: `${ch.name} reached level ${ch.level}!`, text: describeChar(ch) });
    }
  },

  'party.updateChar'(s, op) {
    const ch = s.party.chars[op.id];
    if (ch) Object.assign(ch, op.patch);
  },

  'party.claim'(s, op) {
    const ch = s.party.chars[op.id];
    if (ch) ch.player = op.release ? null : op.by;
  },

  'party.hp'(s, op) {
    const ch = s.party.chars[op.id];
    if (!ch) return;
    const fake = { charId: op.id };
    let text;
    if (op.mode === 'damage') {
      const r = damageCreature(s, fake, op.amount, false);
      actorStats(s, 'pc:' + op.id, ch.name, true).dmgTaken += r.dealt;
      text = `${ch.name} takes ${op.amount} damage` + (r.downed ? ' and falls unconscious!' : '.');
      if (r.downed) { actorStats(s, 'pc:' + op.id, ch.name, true).downs++; s.stats.party.downs++; }
    } else if (op.mode === 'heal') {
      const healed = healCreature(s, fake, op.amount);
      text = `${ch.name} regains ${healed} HP.`;
    } else if (op.mode === 'temp') {
      ch.tempHp = Math.max(ch.tempHp || 0, op.amount | 0);
      text = `${ch.name} gains ${op.amount} temporary HP.`;
    } else if (op.mode === 'set') {
      ch.hp = Math.max(0, Math.min(ch.maxHp, op.amount | 0));
      return;
    }
    if (text) pushLog(s, op, { kind: op.mode === 'damage' ? 'attack' : 'heal', text });
  },

  'party.slot'(s, op) {
    const ch = s.party.chars[op.id];
    if (!ch) return;
    const slot = op.level === 'pact' ? ch.pact : ch.slots?.find(x => x.level === op.level);
    if (slot) slot.used = Math.max(0, Math.min(slot.max, op.used | 0));
  },

  'party.rest'(s, op) {
    const ids = op.id === 'all' ? Object.keys(s.party.chars) : [op.id];
    for (const id of ids) {
      const ch = s.party.chars[id];
      if (!ch || (ch.conditions || []).includes('dead')) continue;
      if (ch.pact) ch.pact.used = 0;
      if (op.kind === 'long') {
        ch.hp = ch.maxHp;
        ch.tempHp = 0;
        for (const sl of ch.slots || []) sl.used = 0;
        ch.deathSaves = { success: 0, fail: 0 };
        removeCondition(ch, 'unconscious');
      } else if (op.heal?.[id]) {
        healCreature(s, { charId: id }, op.heal[id]);
      }
    }
    const who = op.id === 'all' ? 'The party' : s.party.chars[op.id]?.name || 'Someone';
    pushLog(s, op, { kind: 'heal', text: `${who} takes a ${op.kind} rest.` });
  },

  'party.item'(s, op) {
    const list = bagOf(s, op.owner);
    if (!list || !op.item?.id) return;
    const item = { ...op.item, qty: Math.max(1, op.item.qty | 0) };
    const i = list.findIndex(x => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  },

  'party.itemRemove'(s, op) {
    const list = bagOf(s, op.owner);
    const i = list ? list.findIndex(x => x.id === op.itemId) : -1;
    if (i >= 0) list.splice(i, 1);
  },

  // Give / stash: moves op.qty of a stack (all of it by default), merging
  // into a matching unequipped stack at the destination
  'party.itemMove'(s, op) {
    const from = bagOf(s, op.from), to = bagOf(s, op.to);
    const item = from?.find(x => x.id === op.itemId);
    if (!item || !to || from === to) return;
    const n = Math.max(1, Math.min(item.qty, op.qty || item.qty));
    const moved = { ...item, qty: n, equipped: false, ddb: false };
    if (n < item.qty) { item.qty -= n; moved.id = item.id + '-' + op.id; } else from.splice(from.indexOf(item), 1);
    const same = to.find(x => !x.equipped && x.name === moved.name && x.cat === moved.cat);
    if (same) same.qty += n; else to.push(moved);
  },

  'party.removeChar'(s, op) {
    delete s.party.chars[op.id];
    for (const t of Object.values(s.battle.tokens)) {
      if (t.charId === op.id) REDUCERS['battle.removeToken'](s, { id: t.id });
    }
  },

  // ---------------- NPCs ----------------
  'npc.upsert'(s, op) {
    const isNew = !s.npcs[op.npc.id];
    s.npcs[op.npc.id] = op.npc;
    if (isNew && !op.npc.hidden && op.npc.name) {
      pushAdventure(s, op, { icon: 'mask', title: `Met ${op.npc.name}`, text: [op.npc.role, op.npc.location].filter(Boolean).join(' · ') });
    }
  },
  'npc.remove'(s, op) { delete s.npcs[op.id]; },

  // ---------------- Logs ----------------
  'log.add'(s, op) { pushLog(s, op, { kind: 'note', text: String(op.text || '').slice(0, 2000) }); },

  'dice.roll'(s, op) {
    const d = diceStats(s, op.by);
    for (const r of op.rolls || []) {
      d.dice++;
      if (r.sides === 20) {
        d.d20s++; d.d20Sum += r.value;
        if (r.value === 20) d.nat20++;
        if (r.value === 1) d.nat1++;
      }
    }
    const label = op.label ? ` for ${op.label}` : '';
    const detail = (op.rolls || []).map(r => r.value).join(', ');
    pushLog(s, op, { kind: 'roll', text: `${op.by} rolls ${op.notation}${label}: ${op.total}${detail ? ` [${detail}]` : ''}` });
  },

  'adventure.add'(s, op) {
    const e = op.entry;
    s.adventure.push({ id: op.id, ts: op.ts, by: op.by, kind: e.kind || 'note', title: String(e.title || '').slice(0, 200), text: String(e.text || '').slice(0, 20000), icon: e.icon, session: e.session });
    if (s.adventure.length > ADVENTURE_CAP) s.adventure.shift();
  },
  'adventure.update'(s, op) {
    const e = s.adventure.find(x => x.id === op.id);
    if (e) Object.assign(e, { title: op.patch.title ?? e.title, text: op.patch.text ?? e.text, session: op.patch.session ?? e.session });
  },
  'adventure.remove'(s, op) { s.adventure = s.adventure.filter(x => x.id !== op.id); },

  'encounter.update'(s, op) {
    const e = s.encounters.find(x => x.id === op.id);
    if (e) Object.assign(e, { name: op.patch.name ?? e.name, notes: op.patch.notes ?? e.notes });
  },
  'encounter.remove'(s, op) { s.encounters = s.encounters.filter(x => x.id !== op.id); },

  'room.settings'(s, op) {
    if (typeof op.patch.name === 'string') s.meta.name = op.patch.name.slice(0, 80);
    if (op.patch.settings) Object.assign(s.meta.settings, op.patch.settings);
  },
};

function describeChar(ch) {
  const cls = (ch.classes || []).map(c => `${c.name} ${c.level}`).join(' / ');
  return [ch.race, cls].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------
// Player redaction — DM-only information never reaches player sockets
// ------------------------------------------------------------

// Players see exact numbers only for player characters and tokens a player
// controls; everything else is reduced to a rough health state.
export const statsVisibleToPlayers = t => !!(t.charId || t.owner);

const HEALTH_FRACTION = { unhurt: 1, wounded: 0.75, bloodied: 0.45, critical: 0.15, down: 0 };
const HEALTH_LABEL = { unhurt: 'Unhurt', wounded: 'Wounded', bloodied: 'Bloodied', critical: 'Near death', down: 'Down' };

function healthState(hp, maxHp) {
  const pct = maxHp ? hp / maxHp : 1;
  return hp <= 0 ? 'down' : pct >= 1 ? 'unhurt' : pct > 0.5 ? 'wounded' : pct > 0.25 ? 'bloodied' : 'critical';
}

export function redactToken(t) {
  if (statsVisibleToPlayers(t)) return t;
  const { hp, maxHp, tempHp, ac, saves, actions, initBonus, ...rest } = t;
  return { ...rest, redacted: true, health: healthState(hp ?? 0, maxHp ?? 0) };
}

// 0..1 for HP bars, whether or not the exact numbers are known
export function healthFraction(v) {
  if (v.redacted) return HEALTH_FRACTION[v.health] ?? 1;
  return v.maxHp ? Math.max(0, Math.min(1, v.hp / v.maxHp)) : 1;
}

export function healthLabel(v) {
  if ((v.conditions || []).includes('dead')) return 'Dead';
  return HEALTH_LABEL[v.redacted ? v.health : healthState(v.hp ?? 0, v.maxHp ?? 0)];
}

function redactHex(h, fog) {
  if (!h) return null;
  const { dmNote, ...rest } = h;
  if (fog && !h.revealed) return null;
  return Object.keys(rest).length ? rest : null;
}

export function redactSection(key, value, state) {
  switch (key) {
    case 'battle': {
      const tokens = {};
      for (const [id, t] of Object.entries(value.tokens)) if (!t.hidden) tokens[id] = redactToken(t);
      return { ...value, tokens };
    }
    case 'npcs': {
      const out = {};
      for (const [id, n] of Object.entries(value)) {
        if (n.hidden) continue;
        const { dmNotes, ...rest } = n;
        out[id] = rest;
      }
      return out;
    }
    case 'hex': {
      const hexes = {};
      for (const [k, h] of Object.entries(value.hexes)) {
        const r = redactHex(h, value.fog);
        if (r) hexes[k] = r;
      }
      return { ...value, hexes };
    }
    case 'maps': return {};
    case 'encounters': return value.map(e => ({ ...e, notes: '' }));
    default: return value;
  }
}

export function redactState(state) {
  const out = {};
  for (const k of SECTIONS) out[k] = redactSection(k, state[k], state);
  return out;
}

// Snapshot of anything needed to decide what players see, taken BEFORE applying
export function inspectBefore(op, state) {
  if (op.type === 'battle.updateToken' || op.type === 'battle.moveToken' || op.type === 'battle.removeToken') {
    return { wasHidden: !!state.battle.tokens[op.id]?.hidden };
  }
  return {};
}

// Messages to send to a player socket for an op (after it was applied)
export function playerMessages(op, before, state) {
  const opMsg = { type: 'op', op };
  const section = key => ({ type: 'section', key, value: redactSection(key, state[key], state) });
  const hexMsg = keys => {
    const hexes = {};
    for (const k of keys) hexes[k] = redactHex(state.hex.hexes[k], state.hex.fog);
    return { type: 'op', op: { type: 'hex.setMany', id: op.id, ts: op.ts, by: op.by, hexes, party: state.hex.party } };
  };

  const setTokens = tokens => ({ type: 'op', op: { type: 'battle.setTokens', id: op.id, ts: op.ts, by: op.by, tokens } });

  switch (op.type) {
    case 'battle.addToken':
      return op.token.hidden ? [] : [{ type: 'op', op: { ...op, token: redactToken(op.token) } }];
    case 'battle.updateToken': {
      const t = state.battle.tokens[op.id];
      if (!t) return [];
      if (t.hidden && before.wasHidden) return [];
      if (t.hidden) return [{ type: 'op', op: { type: 'battle.removeToken', id: op.id, ts: op.ts, by: op.by } }];
      if (before.wasHidden || !statsVisibleToPlayers(t)) return [setTokens({ [op.id]: redactToken(t) })];
      return [opMsg];
    }
    case 'battle.action':
      return actionMessages(op, state);
    case 'battle.moveToken':
    case 'battle.removeToken':
      return before.wasHidden ? [] : [opMsg];
    case 'battle.setMap':
    case 'battle.loadMap':
      return [section('map'), section('battle')];
    case 'battle.saveMap':
    case 'battle.deleteMap':
      return [];
    case 'npc.upsert':
    case 'npc.remove':
      return [section('npcs'), section('adventure')];
    case 'encounter.update':
      return [section('encounters')];
    case 'hex.paint':
      return [hexMsg((op.hexes || []).map(h => h.k))];
    case 'hex.setHex':
      return [hexMsg([op.k])];
    case 'hex.moveParty': {
      const [c, r] = op.to;
      const keys = [[c, r], ...hexNeighbors(c, r, state.hex.orientation)].map(([a, b]) => hexKey(a, b));
      return [opMsg, hexMsg(keys)];
    }
    case 'hex.config':
      return [section('hex')];
    default:
      return [opMsg];
  }
}

// A resolved attack/spell for players: an animation-only copy of the op with
// monster AC and save bonuses stripped, plus a patch carrying the results.
function actionMessages(op, state) {
  const results = (op.results || []).map(r => {
    const t = state.battle.tokens[r.targetId];
    if (!t || statsVisibleToPlayers(t)) return r;
    const { ac, ...rest } = r;
    if (rest.save) rest.save = { ability: rest.save.ability, dc: rest.save.dc, d20: rest.save.d20, success: rest.save.success };
    return rest;
  });
  const fxOp = { ...op, fx: true, results };

  const tokens = {}, chars = {};
  for (const id of [op.actorId, ...(op.results || []).map(r => r.targetId)]) {
    const t = state.battle.tokens[id];
    if (!t || t.hidden) continue;
    tokens[id] = redactToken(t);
    if (t.charId && state.party.chars[t.charId]) chars[t.charId] = state.party.chars[t.charId];
  }
  const fromOp = e => e.id.startsWith(op.id + ':');
  return [
    { type: 'op', op: fxOp },
    {
      type: 'patch', tokens, chars, combat: state.battle.combat, stats: state.stats,
      encounters: redactSection('encounters', state.encounters, state),
      log: state.log.filter(fromOp), adventure: state.adventure.filter(fromOp),
    },
  ];
}

// Ops a player's browser can't resolve itself (it lacks monster numbers):
// the room sends the player-facing messages back to the sender too.
export const PLAYER_ROUND_TRIP = new Set(['battle.action']);

export { hexKey, parseHexKey };
