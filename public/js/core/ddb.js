// ============================================================
// D&D Beyond character JSON → party character
//
// Accepts the payload from
//   https://character-service.dndbeyond.com/character/v5/character/<id>
// (either the { success, data } wrapper or the bare data object).
// DDB computes a lot on its own front end, so this is a best-effort
// derivation — every number stays editable afterwards.
// ============================================================

import { abilityMod, uid, ABILITIES } from './util.js';
import { unarmedStrike } from './actions.js';

const STAT_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const STAT_BY_ID = { 1: 'str', 2: 'dex', 3: 'con', 4: 'int', 5: 'wis', 6: 'cha' };

const CONDITION_BY_ID = {
  1: 'blinded', 2: 'charmed', 3: 'deafened', 5: 'frightened', 6: 'grappled', 7: 'incapacitated',
  8: 'invisible', 9: 'paralyzed', 10: 'petrified', 11: 'poisoned', 12: 'prone', 13: 'restrained',
  14: 'stunned', 15: 'unconscious',
};

const FULL_CASTER_SLOTS = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const WARLOCK_SLOT_COUNT = [0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];

const CASTER_DIVISOR = { bard: 1, cleric: 1, druid: 1, sorcerer: 1, wizard: 1, paladin: 2, ranger: 2, artificer: 2 };
const THIRD_CASTER_SUBCLASSES = ['eldritch knight', 'arcane trickster'];
const PREPARED_CASTERS = ['cleric', 'druid', 'wizard', 'paladin', 'artificer'];

const CLASS_COLORS = {
  barbarian: '#c0392b', bard: '#8e44ad', cleric: '#b7950b', druid: '#1e8449', fighter: '#1f618d', monk: '#148f77',
  paladin: '#d4ac0d', ranger: '#196f3d', rogue: '#616a6b', sorcerer: '#7d3c98', warlock: '#4a235a', wizard: '#1a5276',
  artificer: '#9c640c',
};

export function extractDdbId(input) {
  const s = String(input || '').trim();
  const m = s.match(/characters\/(\d+)/) || s.match(/character\/(\d+)/) || s.match(/^(\d{3,12})$/);
  return m ? m[1] : null;
}

const safe = (fn, fallback) => { try { const v = fn(); return v ?? fallback; } catch { return fallback; } };

export function parseDdbCharacter(raw) {
  const d = raw?.data && raw.data.name !== undefined ? raw.data : raw;
  if (!d || typeof d !== 'object' || !d.name || !Array.isArray(d.stats)) {
    throw new Error("That doesn't look like a D&D Beyond character JSON");
  }

  // ---- Modifiers (only count item modifiers from equipped / attuned gear) ----
  const activeItemIds = new Set(
    (d.inventory || [])
      .filter(it => it.equipped && (!it.definition?.canAttune || it.isAttuned))
      .map(it => it.definition?.id),
  );
  const mods = [];
  for (const [src, list] of Object.entries(d.modifiers || {})) {
    for (const m of list || []) {
      if (src === 'item' && !activeItemIds.has(m.componentId)) continue;
      mods.push(m);
    }
  }
  const sumBonus = sub => mods.filter(m => m.type === 'bonus' && m.subType === sub).reduce((s, m) => s + (m.value ?? m.fixedValue ?? 0), 0);
  const has = (type, sub) => mods.some(m => m.type === type && m.subType === sub);

  // ---- Ability scores ----
  const abilities = {};
  STAT_NAMES.forEach((name, i) => {
    const id = i + 1;
    const key = ABILITIES[i];
    let score = (d.stats.find(s => s.id === id)?.value ?? 10) + (d.bonusStats?.find(s => s.id === id)?.value ?? 0);
    score += sumBonus(`${name}-score`);
    for (const m of mods) if (m.type === 'set' && m.subType === `${name}-score`) score = Math.max(score, m.value ?? 0);
    const override = d.overrideStats?.find(s => s.id === id)?.value;
    abilities[key] = override || score;
  });
  const mod = k => abilityMod(abilities[k]);

  // ---- Classes / level ----
  const classes = (d.classes || []).map(c => ({
    name: c.definition?.name || 'Adventurer',
    subclass: c.subclassDefinition?.name || '',
    level: c.level || 1,
    raw: c,
  }));
  const level = Math.max(1, classes.reduce((s, c) => s + c.level, 0));
  const prof = 2 + Math.floor((level - 1) / 4);

  // ---- HP ----
  const maxHp = d.overrideHitPoints || Math.max(1,
    (d.baseHitPoints || 0) + mod('con') * level + (d.bonusHitPoints || 0) + sumBonus('hit-points-per-level') * level);
  const hp = Math.max(0, maxHp - (d.removedHitPoints || 0));

  // ---- AC ----
  const ac = safe(() => computeAc(d, mods, mod), 10 + mod('dex'));

  // ---- Saves ----
  const saves = {};
  STAT_NAMES.forEach((name, i) => {
    const k = ABILITIES[i];
    const proficient = has('proficiency', `${name}-saving-throws`);
    saves[k] = mod(k) + (proficient ? prof : 0) + sumBonus('saving-throws') + sumBonus(`${name}-saving-throws`);
  });

  // ---- Misc ----
  const armorWorn = (d.inventory || []).some(it => it.equipped && [1, 2, 3].includes(it.definition?.armorTypeId));
  const speed = safe(() => d.race.weightSpeeds.normal.walk, 30) + sumBonus('speed') + (armorWorn ? 0 : sumBonus('unarmored-movement'));
  const percProf = has('expertise', 'perception') ? prof * 2 : has('proficiency', 'perception') ? prof : 0;
  const passivePerception = 10 + mod('wis') + percProf + sumBonus('passive-perception');
  const initBonus = mod('dex') + sumBonus('initiative');

  // ---- Spellcasting ----
  const casterInfo = safe(() => spellcasting(d, classes, mods, mod, prof, sumBonus), { slots: [], pact: null, dc: null, attack: null, castMod: 0 });

  const ch = {
    id: 'ddb-' + d.id,
    ddbId: d.id,
    name: d.name,
    avatar: safe(() => d.decorations?.avatarUrl || d.avatarUrl, null),
    race: safe(() => d.race.fullName || d.race.baseName, ''),
    classes: classes.map(({ name, subclass, level: l }) => ({ name, subclass, level: l })),
    level,
    xp: d.currentXp || 0,
    hp, maxHp, tempHp: d.temporaryHitPoints || 0,
    ac, speed, initBonus, profBonus: prof, passivePerception,
    abilities, saves,
    slots: casterInfo.slots,
    pact: casterInfo.pact,
    spellDc: casterInfo.dc,
    spellAttack: casterInfo.attack,
    conditions: (d.conditions || []).map(c => CONDITION_BY_ID[c.id]).filter(Boolean),
    deathSaves: { success: d.deathSaves?.successCount || 0, fail: d.deathSaves?.failCount || 0 },
    inspiration: !!d.inspiration,
    gold: safe(() => Math.round((d.currencies.gp || 0) + (d.currencies.pp || 0) * 10 + (d.currencies.ep || 0) / 2 + (d.currencies.sp || 0) / 10), 0),
    color: CLASS_COLORS[classes[0]?.name.toLowerCase()] || '#2e6b8a',
    importedAt: Date.now(),
  };
  ch.actions = [
    ...safe(() => weaponAttacks(d, mods, abilities, prof), []),
    unarmedStrike(abilities.str, prof),
    ...safe(() => spellActions(d, classes, casterInfo, level), []),
  ];
  return ch;
}

function computeAc(d, mods, mod) {
  const equipped = (d.inventory || []).filter(it => it.equipped && it.definition);
  const armor = equipped.find(it => [1, 2, 3].includes(it.definition.armorTypeId));
  const shield = equipped.find(it => it.definition.armorTypeId === 4);
  const dex = mod('dex');
  let ac;
  if (armor) {
    const t = armor.definition.armorTypeId;
    ac = (armor.definition.armorClass || 10) + (t === 1 ? dex : t === 2 ? Math.min(dex, 2) : 0);
  } else {
    ac = 10 + dex;
    let best = 0;
    for (const m of mods) {
      if (m.type === 'set' && m.subType === 'unarmored-armor-class') {
        best = Math.max(best, m.statId ? mod(STAT_BY_ID[m.statId]) : (m.value || 0));
      }
    }
    ac += best;
  }
  if (shield) ac += shield.definition.armorClass || 2;
  for (const m of mods) {
    if (m.type !== 'bonus') continue;
    if (m.subType === 'armor-class') ac += m.value || 0;
    if (m.subType === 'armored-armor-class' && armor) ac += m.value || 0;
  }
  return ac;
}

function spellcasting(d, classes, mods, mod, prof, sumBonus) {
  const casters = [];
  let warlock = null;
  for (const c of classes) {
    const def = c.raw.definition || {};
    const sub = c.raw.subclassDefinition || {};
    const lname = c.name.toLowerCase();
    if (lname === 'warlock') { warlock = c; continue; }
    const rules = (def.canCastSpells && def.spellRules) || (sub.canCastSpells && sub.spellRules) || null;
    let divisor = rules?.multiClassSpellSlotDivisor || CASTER_DIVISOR[lname] || 0;
    if (!divisor && THIRD_CASTER_SUBCLASSES.includes(sub.name?.toLowerCase())) divisor = 3;
    if (!divisor) continue;
    casters.push({ c, rules, divisor, roundUp: rules?.multiClassSpellSlotRounding === 2 || lname === 'artificer' });
  }

  let counts = [];
  if (casters.length === 1 && casters[0].rules?.levelSpellSlots?.[casters[0].c.level]) {
    counts = casters[0].rules.levelSpellSlots[casters[0].c.level];
  } else if (casters.length) {
    const cl = casters.reduce((s, x) => s + (x.roundUp ? Math.ceil(x.c.level / x.divisor) : Math.floor(x.c.level / x.divisor)), 0);
    counts = FULL_CASTER_SLOTS[Math.min(20, cl)] || [];
  }
  const slots = [];
  counts.forEach((max, i) => {
    if (max > 0) slots.push({ level: i + 1, max, used: d.spellSlots?.find(s => s.level === i + 1)?.used || 0 });
  });

  let pact = null;
  if (warlock) {
    const l = warlock.level;
    const slotLevel = Math.min(5, Math.ceil(l / 2));
    pact = { level: slotLevel, max: WARLOCK_SLOT_COUNT[l] || 1, used: d.pactMagic?.find(s => s.level === slotLevel)?.used || 0 };
  }

  // Primary casting ability: first spellcasting class (warlock included)
  const primary = [...casters.map(x => x.c), warlock].filter(Boolean)[0];
  const abilityId = primary ? (primary.raw.definition?.spellCastingAbilityId || primary.raw.subclassDefinition?.spellCastingAbilityId) : null;
  const castKey = STAT_BY_ID[abilityId];
  const castMod = castKey ? mod(castKey) : 0;
  return {
    slots, pact, castMod, castKey,
    dc: castKey ? 8 + prof + castMod + sumBonus('spell-save-dc') : null,
    attack: castKey ? prof + castMod + sumBonus('spell-attacks') : null,
    classCast: Object.fromEntries(classes.map(c => {
      const id = c.raw.definition?.spellCastingAbilityId || c.raw.subclassDefinition?.spellCastingAbilityId;
      const k = STAT_BY_ID[id];
      return [c.raw.id, k ? { dc: 8 + prof + mod(k) + sumBonus('spell-save-dc'), attack: prof + mod(k) + sumBonus('spell-attacks'), castMod: mod(k), warlock: c.name.toLowerCase() === 'warlock', prepared: PREPARED_CASTERS.includes(c.name.toLowerCase()) } : null];
    })),
  };
}

function weaponAttacks(d, mods, abilities, prof) {
  const out = [];
  for (const it of d.inventory || []) {
    const def = it.definition;
    if (!it.equipped || !def?.damage?.diceString) continue;
    const props = (def.properties || []).map(p => p.name?.toLowerCase());
    const ranged = def.attackType === 2;
    const str = abilityMod(abilities.str), dex = abilityMod(abilities.dex);
    const m = ranged ? dex : props.includes('finesse') ? Math.max(str, dex) : str;
    const magic = (def.grantedModifiers || []).filter(g => g.type === 'bonus' && g.subType === 'magic').reduce((s, g) => s + (g.value || 0), 0);
    const total = m + magic;
    out.push({
      id: uid(6), name: def.name, kind: ranged ? 'ranged' : 'melee',
      bonus: m + prof + magic,
      damage: def.damage.diceString + (total ? (total > 0 ? '+' : '') + total : ''),
      dmgType: String(def.damageType || '').toLowerCase(),
      range: ranged ? (def.range || 80) : props.includes('reach') ? 10 : 5,
      radius: 0, cost: 'action', targets: 1, slot: 0,
    });
  }
  return out;
}

const SPECIAL_SPELLS = {
  'eldritch blast': (lvl) => ({ targets: lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1, noScale: true }),
  'magic missile': () => ({ targets: 3, kind: 'auto', damage: '1d4+1' }),
  'scorching ray': () => ({ targets: 3 }),
};

function spellActions(d, classes, info, charLevel) {
  const entries = [];
  for (const group of d.classSpells || []) {
    const cast = info.classCast?.[group.characterClassId];
    for (const sp of group.spells || []) {
      const lvl = sp.definition?.level ?? 0;
      if (cast?.prepared && lvl > 0 && !sp.prepared && !sp.alwaysPrepared) continue;
      entries.push({ def: sp.definition, cast });
    }
  }
  for (const list of Object.values(d.spells || {})) {
    for (const sp of list || []) if (sp.definition) entries.push({ def: sp.definition, cast: null });
  }

  const out = [];
  const seen = new Set();
  for (const { def, cast } of entries) {
    if (!def?.name || seen.has(def.name)) continue;
    const dmgMod = (def.modifiers || []).find(m => m.type === 'damage' && m.die);
    const healMod = (def.modifiers || []).find(m => m.type === 'bonus' && m.subType === 'hit-points' && m.die);
    const m = dmgMod || healMod;
    if (!m) continue;
    seen.add(def.name);

    const c = cast || { dc: info.dc ?? 13, attack: info.attack ?? 5, castMod: info.castMod || 0 };
    const special = SPECIAL_SPELLS[def.name.toLowerCase()]?.(charLevel) || {};
    let count = m.die.diceCount || 0;
    if (def.level === 0 && count && !special.noScale) count *= charLevel >= 17 ? 4 : charLevel >= 11 ? 3 : charLevel >= 5 ? 2 : 1;
    let dice = count ? `${count}d${m.die.diceValue}` : '';
    let fixed = m.die.fixedValue || 0;
    if (m.usePrimaryStat) fixed += c.castMod || 0;
    if (fixed) dice += (dice ? (fixed > 0 ? '+' : '') : '') + fixed;

    const range = def.range || {};
    const aoe = range.aoeValue || 0;
    const selfAoe = range.origin === 'Self' && aoe;
    const radius = aoe ? (/cone|line|cube/i.test(range.aoeType || '') ? Math.round(aoe / 2) : aoe) : 0;
    const kind = healMod && !dmgMod ? 'heal' : def.requiresAttackRoll ? 'spell' : def.requiresSavingThrow ? 'save' : 'auto';

    out.push({
      id: uid(6), name: def.name, kind: special.kind || kind, isSpell: true,
      bonus: c.attack, dc: c.dc, save: STAT_BY_ID[def.saveDcAbilityId] || 'dex',
      damage: special.damage || dice || '1',
      dmgType: healMod && !dmgMod ? 'healing' : String(m.subType || '').toLowerCase(),
      range: selfAoe ? aoe : (range.rangeValue || (range.origin === 'Touch' ? 5 : 30)),
      radius, half: def.level > 0,
      cost: def.activation?.activationType === 3 ? 'bonus' : 'action',
      targets: special.targets || 1,
      slot: def.level || 0,
      pact: !!c.warlock && def.level > 0,
    });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export function blankCharacter(name = 'New Hero') {
  const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  return {
    id: 'pc-' + uid(8), name, avatar: null, race: '', classes: [{ name: 'Fighter', subclass: '', level: 1 }], level: 1, xp: 0,
    hp: 10, maxHp: 10, tempHp: 0, ac: 10, speed: 30, initBonus: 0, profBonus: 2, passivePerception: 10,
    abilities, saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    slots: [], pact: null, spellDc: null, spellAttack: null, conditions: [], deathSaves: { success: 0, fail: 0 },
    inspiration: false, gold: 0, color: '#2e6b8a', actions: [unarmedStrike(10, 2)],
  };
}
