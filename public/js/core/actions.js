// ============================================================
// Actions: stat-block line format, character defaults, and
// client-side resolution (rolls happen here, then travel in the op)
// ============================================================

import { roll, rollD20 } from './dice.js';
import { uid, abilityMod } from './util.js';
import { COVER_BONUS } from './cover.js';

// Line format:  Name | kind | bonus-or-DC | damage | range ft | area | flags
//   kind: melee, ranged, spell, save:dex, heal, auto
//   area: radius in ft ("20"), or a size and shape ("15 cone", "100 line", "10 cube")
//   flags (comma separated): bonus, slot:3, pact, targets:3, nohalf, conc,
//     up:1d6 (extra dice per slot level above the spell's), up:target (extra target per level),
//     cond:prone (condition applied on a hit / failed save; repeatable)
export function parseActionLine(line) {
  const parts = line.split('|').map(s => s.trim());
  if (!parts[0]) return null;
  const [name, kindRaw = 'melee', num = '0', dmg = '', range = '', radius = '', flags = ''] = parts;
  const kindL = kindRaw.toLowerCase();
  const a = {
    id: uid(6), name, kind: kindL.startsWith('save') ? 'save' : (['melee', 'ranged', 'spell', 'heal', 'auto'].includes(kindL) ? kindL : 'melee'),
    range: parseInt(range, 10) || (kindL === 'melee' ? 5 : 60),
    radius: parseInt(radius, 10) || 0,
    cost: 'action', targets: 1, slot: 0, half: true,
  };
  const shape = String(radius).toLowerCase().match(/cone|line|cube/)?.[0];
  if (shape && a.radius) a.shape = shape;
  if (a.kind === 'save') { a.save = (kindL.split(':')[1] || 'dex').slice(0, 3); a.dc = parseInt(num, 10) || 10; }
  else a.bonus = parseInt(num, 10) || 0;
  const dm = dmg.match(/^([0-9d+\-\s]+)\s*([a-z]*)$/i);
  a.damage = (dm ? dm[1] : dmg).replace(/\s+/g, '');
  a.dmgType = dm?.[2]?.toLowerCase() || (a.kind === 'heal' ? 'healing' : '');
  for (const f of flags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (f === 'bonus') a.cost = 'bonus';
    else if (f === 'pact') a.pact = true;
    else if (f === 'nohalf') a.half = false;
    else if (f === 'conc') a.conc = true;
    else if (f === 'up:target') a.upcast = { targets: 1 };
    else if (f.startsWith('cond:') && f.length > 5) (a.conds ||= []).push(f.slice(5).trim());
    else if (/^up:\d+d\d+$/.test(f)) a.upcast = { dice: f.slice(3) };
    else if (f.startsWith('slot:')) a.slot = parseInt(f.slice(5), 10) || 0;
    else if (f.startsWith('targets:')) a.targets = Math.max(1, parseInt(f.slice(8), 10) || 1);
  }
  return a;
}

export function actionToLine(a) {
  const kind = a.kind === 'save' ? `save:${a.save}` : a.kind;
  const num = a.kind === 'save' ? a.dc : (a.bonus ?? 0);
  const flags = [a.cost === 'bonus' && 'bonus', a.slot && `slot:${a.slot}`, a.pact && 'pact', a.targets > 1 && `targets:${a.targets}`, a.half === false && 'nohalf',
    a.conc && 'conc', a.upcast?.dice && `up:${a.upcast.dice}`, a.upcast?.targets && 'up:target', ...(a.conds || []).map(c => `cond:${c}`)].filter(Boolean).join(', ');
  const area = a.radius ? `${a.radius}${a.shape ? ' ' + a.shape : ''}` : '';
  return [a.name, kind, num, `${a.damage || ''} ${a.dmgType || ''}`.trim(), a.range || '', area, flags].join(' | ')
    .replace(/(\s\|\s)+$/, '').replace(/\|  (?=\|)/g, '| ');   // empty fields read "| |
}

export const parseActionText = text => String(text || '').split('\n').map(parseActionLine).filter(Boolean);
export const actionsToText = list => (list || []).map(actionToLine).join('\n');

export function unarmedStrike(str = 10, prof = 2) {
  const m = abilityMod(str);
  return { id: 'unarmed', name: 'Unarmed Strike', kind: 'melee', bonus: m + prof, damage: String(Math.max(1, 1 + m)), dmgType: 'bludgeoning', range: 5, radius: 0, cost: 'action', targets: 1, slot: 0 };
}

export function describeAction(a) {
  const bits = [];
  if (a.kind === 'save') bits.push(`DC ${a.dc} ${a.save?.toUpperCase()}`);
  else if (a.kind !== 'heal' && a.kind !== 'auto') bits.push(`${a.bonus >= 0 ? '+' : ''}${a.bonus} to hit`);
  if (a.damage) bits.push(`${a.damage} ${a.dmgType || ''}`.trim());
  bits.push(a.range <= 5 ? 'melee' : `${a.range} ft`);
  if (a.radius) bits.push(`${a.radius} ft ${a.shape || 'radius'}`);
  if (a.slot) bits.push(a.pact ? 'pact slot' : `lvl ${a.slot} slot`);
  if (a.upcast) bits.push(`+${a.upcast.dice || '1 target'} per higher slot`);
  if (a.conc) bits.push('concentration');
  if (a.conds?.length) bits.push(a.conds.join(', '));
  if (a.cost === 'bonus') bits.push('bonus action');
  return bits.join(' · ');
}

const ORD = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

// Adds `extra` dice ("1d6") `times` times to a damage expression, merging
// into a matching die term when there is one: "8d6" + 2×"1d6" → "10d6"
export function addDice(expr, extra, times) {
  const m = String(extra).match(/^(\d+)d(\d+)$/);
  if (!m || times <= 0) return expr;
  const n = +m[1] * times, sides = m[2];
  const term = new RegExp(`(^|[+-])(\\d*)d${sides}(?!\\d)`);
  if (term.test(expr)) return expr.replace(term, (_, sign, count) => `${sign}${(+count || 1) + n}d${sides}`);
  return expr ? `${expr}+${n}d${sides}` : `${n}d${sides}`;
}

// The action as cast from a higher slot: extra dice / targets per level above
// its base, and a name that shows the level ("Fireball (4th)")
export function upcastAction(a, level) {
  if (!a.slot || !level || level <= a.slot) return a;
  const up = level - a.slot;
  const out = { ...a, slot: level, name: `${a.name} (${ORD(level)})`, baseName: a.name };
  if (a.upcast?.dice) out.damage = addDice(a.damage || '', a.upcast.dice, up);
  if (a.upcast?.targets) out.targets = (a.targets || 1) + a.upcast.targets * up;
  return out;
}

// Rolls the dice and returns a 'battle.action' op ready to dispatch.
// Only raw rolls go in the op: whether an attack hits or a save succeeds is
// decided by the reducer against the target's real AC / save bonus, so a
// player's browser never needs to know a monster's numbers.
// targets: token views (may repeat for multi-dart spells); a target's
// `cover` ('half' | 'three') travels along and is applied by the reducer.
export function resolveAction(actorView, action, targets, { adv = 0, point = null } = {}) {
  const results = [];
  const sharedSaveDamage = action.kind === 'save' && action.damage ? roll(action.damage).total : 0;

  for (const t of targets) {
    const r = { targetId: t.id, targetName: t.name };
    if (action.kind === 'heal') {
      r.heal = roll(action.damage || '1d4').total;
    } else if (action.kind === 'save') {
      if (t.cover && action.save === 'dex' && COVER_BONUS[t.cover]) r.cover = t.cover;
      r.save = { ability: action.save, dc: action.dc, d20: rollD20().value };
      r.dmgRoll = sharedSaveDamage;
    } else if (action.kind === 'auto') {
      r.dmgRoll = action.damage ? roll(action.damage).total : 0;
    } else {
      if (COVER_BONUS[t.cover]) r.cover = t.cover;
      const d = rollD20(adv);
      const crit = d.value === 20;
      r.attack = { rolls: d.rolls, value: d.value, bonus: action.bonus || 0, total: d.value + (action.bonus || 0), adv };
      r.dmgRoll = action.damage ? roll(action.damage, { crit }).total : 0;
    }
    results.push(r);
  }

  return actionOp(actorView, action, results, point);
}

// Wraps rolled results into a 'battle.action' op
export function actionOp(actorView, action, results, point = null) {
  return {
    type: 'battle.action',
    actorId: actorView.id,
    actorName: actorView.name,
    action: {
      name: action.name, kind: action.kind, dmgType: action.dmgType, cost: action.cost,
      slot: action.slot || 0, pact: !!action.pact, radius: action.radius || 0, isSpell: !!action.isSpell || !!action.slot,
      half: action.half !== false, ...(action.shape && { shape: action.shape, range: action.range }), ...(action.conc && { conc: action.baseName || action.name }),
      ...(action.conds?.length && { conds: action.conds }),
    },
    point,
    // Shaped areas (cone, line, cube) are laid out from the caster's space
    ...(action.shape && point && { caster: { col: actorView.col, row: actorView.row, size: actorView.size || 1 } }),
    results,
  };
}
