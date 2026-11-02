// ============================================================
// Actions: stat-block line format, character defaults, and
// client-side resolution (rolls happen here, then travel in the op)
// ============================================================

import { roll, rollD20 } from './dice.js';
import { uid, abilityMod } from './util.js';
import { COVER_BONUS } from './cover.js';

// Line format:  Name | kind | bonus-or-DC | damage | range ft | radius ft | flags
//   kind: melee, ranged, spell, save:dex, heal, auto
//   flags (comma separated): bonus, slot:3, pact, targets:3, nohalf
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
  if (a.kind === 'save') { a.save = (kindL.split(':')[1] || 'dex').slice(0, 3); a.dc = parseInt(num, 10) || 10; }
  else a.bonus = parseInt(num, 10) || 0;
  const dm = dmg.match(/^([0-9d+\-\s]+)\s*([a-z]*)$/i);
  a.damage = (dm ? dm[1] : dmg).replace(/\s+/g, '');
  a.dmgType = dm?.[2]?.toLowerCase() || (a.kind === 'heal' ? 'healing' : '');
  for (const f of flags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (f === 'bonus') a.cost = 'bonus';
    else if (f === 'pact') a.pact = true;
    else if (f === 'nohalf') a.half = false;
    else if (f.startsWith('slot:')) a.slot = parseInt(f.slice(5), 10) || 0;
    else if (f.startsWith('targets:')) a.targets = Math.max(1, parseInt(f.slice(8), 10) || 1);
  }
  return a;
}

export function actionToLine(a) {
  const kind = a.kind === 'save' ? `save:${a.save}` : a.kind;
  const num = a.kind === 'save' ? a.dc : (a.bonus ?? 0);
  const flags = [a.cost === 'bonus' && 'bonus', a.slot && `slot:${a.slot}`, a.pact && 'pact', a.targets > 1 && `targets:${a.targets}`, a.half === false && 'nohalf'].filter(Boolean).join(', ');
  return [a.name, kind, num, `${a.damage || ''} ${a.dmgType || ''}`.trim(), a.range || '', a.radius || '', flags].join(' | ').replace(/(\s\|\s)+$/, '');
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
  if (a.radius) bits.push(`${a.radius} ft radius`);
  if (a.slot) bits.push(a.pact ? 'pact slot' : `lvl ${a.slot} slot`);
  if (a.cost === 'bonus') bits.push('bonus action');
  return bits.join(' · ');
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
      half: action.half !== false,
    },
    point,
    results,
  };
}
