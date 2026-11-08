// Run with: npm run check
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyOp, canApply, redactState, playerMessages, inspectBefore, tokenView, redactSection, checkAttack } from '../public/js/core/ops.js';
import { parseDice, roll } from '../public/js/core/dice.js';
import { hexDistance, hexNeighbors, hexCenter, pixelToHex } from '../public/js/core/hexmath.js';
import { parseActionLine, actionToLine, resolveAction } from '../public/js/core/actions.js';
import { parseDdbCharacter, extractDdbId } from '../public/js/core/ddb.js';

const DM = { name: 'Dee', role: 'dm' };
const PLAYER = { name: 'Pat', role: 'player' };
let n = 0;
const op = (o, by = 'Dee') => ({ id: 'op' + (++n), ts: 1000 + n, by, ...o });

function withParty() {
  const s = initialState();
  applyOp(s, op({ type: 'party.upsertChar', char: { id: 'c1', name: 'Aria', player: 'Pat', hp: 20, maxHp: 20, tempHp: 0, ac: 15, level: 3, classes: [{ name: 'Rogue', level: 3 }], conditions: [], slots: [{ level: 1, max: 2, used: 0 }] } }));
  applyOp(s, op({ type: 'battle.addToken', token: { id: 'pc', charId: 'c1', col: 1, row: 1 } }));
  applyOp(s, op({ type: 'battle.addToken', token: { id: 'gob', name: 'Goblin', col: 2, row: 1, hp: 7, maxHp: 7, ac: 15, conditions: [] } }));
  return s;
}

test('dice notation parses and rolls within bounds', () => {
  assert.deepEqual(parseDice('2d6+1d4-1'), { dice: [{ count: 2, sides: 6, sign: 1 }, { count: 1, sides: 4, sign: 1 }], mod: -1 });
  for (let i = 0; i < 200; i++) {
    const r = roll('2d6+3');
    assert.ok(r.total >= 5 && r.total <= 15);
    assert.equal(roll('1d8', { crit: true }).rolls.length, 2);
  }
});

test('hex math round-trips and measures distance', () => {
  for (const o of ['flat', 'pointy']) {
    for (const [c, r] of [[0, 0], [3, 4], [7, 2], [5, 5]]) {
      const p = hexCenter(c, r, 30, o);
      assert.deepEqual(pixelToHex(p.x, p.y, 30, o), [c, r]);
      for (const nb of hexNeighbors(c, r, o)) assert.equal(hexDistance([c, r], nb, o), 1);
    }
    assert.equal(hexDistance([0, 0], [4, 0], o), 4);
  }
});

test('action lines round-trip', () => {
  const a = parseActionLine('Fire Breath | save:dex | 13 | 7d6 fire | 15 | 15 | bonus, slot:3');
  assert.equal(a.kind, 'save'); assert.equal(a.dc, 13); assert.equal(a.save, 'dex');
  assert.equal(a.damage, '7d6'); assert.equal(a.dmgType, 'fire'); assert.equal(a.radius, 15);
  assert.equal(a.cost, 'bonus'); assert.equal(a.slot, 3);
  const b = parseActionLine(actionToLine(a));
  assert.deepEqual({ ...b, id: 0 }, { ...a, id: 0 });
});

test('attack applies damage, kills, logs and records stats', () => {
  const s = withParty();
  const o = op({ type: 'battle.action', actorId: 'pc', action: { name: 'Rapier', kind: 'melee', dmgType: 'piercing' },
    results: [{ targetId: 'gob', hit: true, crit: true, ac: 15, attack: { rolls: [20], value: 20, bonus: 5, total: 25 }, damage: 12 }] }, 'Pat');
  assert.equal(canApply(o, PLAYER, s), true);
  applyOp(s, o);
  assert.equal(s.battle.tokens.gob.hp, 0);
  assert.ok(s.battle.tokens.gob.conditions.includes('dead'));
  const st = s.stats.actors['pc:c1'];
  assert.equal(st.dmgDealt, 7, 'overkill does not count');
  assert.equal(st.kills, 1); assert.equal(st.crits, 1);
  assert.equal(s.stats.dice.Pat.nat20, 1);
  assert.ok(s.log.some(l => l.text.includes('SLAIN')));
});

test('PC damage flows to the character sheet, temp HP first, then downed', () => {
  const s = withParty();
  applyOp(s, op({ type: 'party.hp', id: 'c1', mode: 'temp', amount: 5 }));
  applyOp(s, op({ type: 'battle.action', actorId: 'gob', action: { name: 'Scimitar', kind: 'melee' }, results: [{ targetId: 'pc', hit: true, damage: 8 }] }));
  assert.equal(s.party.chars.c1.tempHp, 0);
  assert.equal(s.party.chars.c1.hp, 17);
  applyOp(s, op({ type: 'battle.action', actorId: 'gob', action: { name: 'Scimitar', kind: 'melee' }, results: [{ targetId: 'pc', hit: true, damage: 30 }] }));
  assert.equal(s.party.chars.c1.hp, 0);
  assert.ok(s.party.chars.c1.conditions.includes('unconscious'));
  assert.equal(tokenView(s, s.battle.tokens.pc).hp, 0);
  applyOp(s, op({ type: 'battle.action', actorId: 'pc', action: { name: 'Potion', kind: 'heal' }, results: [{ targetId: 'pc', heal: 4 }] }));
  assert.equal(s.party.chars.c1.hp, 4);
  assert.ok(!s.party.chars.c1.conditions.includes('unconscious'));
});

test('spell slot is spent when a levelled spell is cast', () => {
  const s = withParty();
  applyOp(s, op({ type: 'battle.action', actorId: 'pc', action: { name: 'Sleep', kind: 'auto', slot: 1 }, results: [] }));
  assert.equal(s.party.chars.c1.slots[0].used, 1);
});

test('combat flow builds an encounter record', () => {
  const s = withParty();
  applyOp(s, op({ type: 'battle.combatStart', encId: 'e1', name: 'Ambush', order: [{ id: 'gob', init: 12 }, { id: 'pc', init: 18 }] }));
  assert.equal(s.battle.combat.order[0].id, 'pc');
  assert.equal(canApply(op({ type: 'battle.combatNext' }), PLAYER, s), true, 'player ends own turn');
  applyOp(s, op({ type: 'battle.combatNext' }));
  assert.equal(canApply(op({ type: 'battle.combatNext' }), PLAYER, s), 'It is not your turn');
  applyOp(s, op({ type: 'battle.combatNext' }));
  assert.equal(s.battle.combat.round, 2);
  applyOp(s, op({ type: 'battle.combatEnd' }));
  assert.equal(s.encounters[0].rounds, 2);
  assert.ok(s.encounters[0].end);
  assert.equal(s.battle.combat.active, false);
  assert.ok(s.adventure.some(e => e.title.includes('Ambush')));
});

test('players cannot do DM things or touch other characters', () => {
  const s = withParty();
  assert.notEqual(canApply(op({ type: 'battle.paint', cells: [] }), PLAYER, s), true);
  assert.notEqual(canApply(op({ type: 'npc.upsert', npc: { id: 'n' } }), PLAYER, s), true);
  assert.notEqual(canApply(op({ type: 'battle.moveToken', id: 'gob', path: [[0, 0]] }), PLAYER, s), true);
  assert.equal(canApply(op({ type: 'battle.moveToken', id: 'pc', path: [[0, 0]] }), PLAYER, s), true);
  assert.notEqual(canApply(op({ type: 'party.hp', id: 'c1', mode: 'heal', amount: 1 }), { name: 'Eve', role: 'player' }, s), true);
  applyOp(s, op({ type: 'room.settings', patch: { settings: { playersCanEdit: true } } }));
  assert.equal(canApply(op({ type: 'battle.paint', cells: [] }), PLAYER, s), true);
  assert.equal(canApply(op({ type: 'bogus' }), DM, s), 'Unknown operation');
});

test('redaction hides DM secrets from players', () => {
  const s = withParty();
  applyOp(s, op({ type: 'npc.upsert', npc: { id: 'n1', name: 'Spy', hidden: true } }));
  applyOp(s, op({ type: 'npc.upsert', npc: { id: 'n2', name: 'Barkeep', dmNotes: 'is a dragon' } }));
  applyOp(s, op({ type: 'hex.paint', hexes: [{ k: '1,1', patch: { terrain: 'forest', dmNote: 'lair' } }, { k: '2,2', patch: { terrain: 'hills', revealed: true, dmNote: 'x' } }] }));
  const before = inspectBefore(op({ type: 'battle.updateToken', id: 'gob' }), s);
  const hideOp = op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: true } });
  applyOp(s, hideOp);
  const r = redactState(s);
  assert.equal(r.npcs.n1, undefined);
  assert.equal(r.npcs.n2.dmNotes, undefined);
  assert.equal(r.hex.hexes['1,1'], undefined, 'fogged hex is hidden');
  assert.deepEqual(r.hex.hexes['2,2'], { terrain: 'hills', revealed: true });
  assert.equal(r.battle.tokens.gob, undefined);
  assert.equal(playerMessages(hideOp, before, s)[0].op.type, 'battle.removeToken');
  // Unhiding sends players the (stat-stripped) token
  const b2 = inspectBefore({ type: 'battle.updateToken', id: 'gob' }, s);
  const show = op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: false } });
  applyOp(s, show);
  const shown = playerMessages(show, b2, s)[0].op;
  assert.equal(shown.type, 'battle.setTokens');
  assert.equal(shown.tokens.gob.hp, undefined);
  // State JSON never contains the DM note after redaction
  assert.ok(!JSON.stringify(redactState(s)).includes('is a dragon'));
});

test('hex travel reveals and logs', () => {
  const s = initialState();
  applyOp(s, op({ type: 'hex.moveParty', to: [2, 2], dist: 0 }));
  applyOp(s, op({ type: 'hex.moveParty', to: [4, 2], dist: 2, terrainLabel: 'forest' }));
  assert.equal(s.stats.party.hexes, 2);
  assert.ok(s.hex.hexes['4,2'].revealed);
  assert.ok(s.adventure.some(e => e.text.includes('12 mi')));
});

test('resolveAction sends raw dice; the reducer decides hits against the real AC', () => {
  const actor = { id: 'pc', name: 'A' };
  // A player's view of a monster has no AC or saves — resolveAction must not need them
  const blind = { id: 'gob', name: 'Goblin', redacted: true };
  const atk = resolveAction(actor, { name: 'Bow', kind: 'ranged', bonus: 30, damage: '1d6+2' }, [blind]);
  assert.equal(atk.results[0].hit, undefined);
  assert.ok(atk.results[0].dmgRoll >= 3);
  const s = withParty();
  applyOp(s, op(atk));
  const r = atk.results[0];
  assert.equal(r.ac, 15);
  assert.equal(r.hit, r.attack.value !== 1);
  const fb = resolveAction(actor, { name: 'Fireball', kind: 'save', dc: 99, save: 'dex', damage: '8d6', radius: 20 }, [blind, { ...blind, id: 'gob2' }], { point: [3, 3] });
  assert.equal(fb.results[0].dmgRoll, fb.results[1].dmgRoll, 'AoE shares one damage roll');
  applyOp(s, op(fb));
  assert.equal(fb.results[0].save.success, false);
  assert.ok(fb.results[0].damage >= 8);
});

// A trimmed D&D Beyond v5 payload with the fields the importer reads
const DDB = {
  success: true,
  data: {
    id: 123456, name: 'Thalia', currentXp: 900, baseHitPoints: 20, bonusHitPoints: 0, removedHitPoints: 5, temporaryHitPoints: 3,
    inspiration: true, decorations: { avatarUrl: 'https://example.com/a.png' },
    race: { fullName: 'Hill Dwarf', weightSpeeds: { normal: { walk: 25 } } },
    stats: [1, 2, 3, 4, 5, 6].map(id => ({ id, value: [10, 14, 14, 10, 15, 12][id - 1] })),
    bonusStats: [], overrideStats: [],
    classes: [{ id: 77, level: 3, definition: { name: 'Cleric', spellCastingAbilityId: 5, canCastSpells: true, spellRules: { multiClassSpellSlotDivisor: 1, levelSpellSlots: [[], [2], [3], [4, 2]] } }, subclassDefinition: { name: 'Life Domain' } }],
    modifiers: {
      race: [{ type: 'bonus', subType: 'constitution-score', value: 2 }, { type: 'bonus', subType: 'wisdom-score', value: 1 }, { type: 'bonus', subType: 'hit-points-per-level', value: 1 }],
      class: [{ type: 'proficiency', subType: 'wisdom-saving-throws' }, { type: 'proficiency', subType: 'charisma-saving-throws' }, { type: 'proficiency', subType: 'perception' }],
      item: [{ type: 'bonus', subType: 'armor-class', value: 1, componentId: 900 }, { type: 'bonus', subType: 'armor-class', value: 5, componentId: 901 }],
      background: [], feat: [],
    },
    inventory: [
      { equipped: true, definition: { id: 1, name: 'Chain Mail', armorTypeId: 3, armorClass: 16 } },
      { equipped: true, definition: { id: 2, name: 'Shield', armorTypeId: 4, armorClass: 2 } },
      { equipped: true, isAttuned: true, definition: { id: 900, name: 'Ring of Protection', canAttune: true } },
      { equipped: false, definition: { id: 901, name: 'Unequipped Thing' } },
      { equipped: true, definition: { id: 3, name: 'Mace', attackType: 1, damage: { diceString: '1d6' }, damageType: 'Bludgeoning', range: 5, properties: [] } },
    ],
    spellSlots: [{ level: 1, used: 1, available: 0 }, { level: 2, used: 0, available: 0 }],
    pactMagic: [],
    classSpells: [{ characterClassId: 77, spells: [
      { prepared: true, definition: { name: 'Guiding Bolt', level: 1, requiresAttackRoll: true, range: { origin: 'Ranged', rangeValue: 120 }, modifiers: [{ type: 'damage', subType: 'radiant', die: { diceCount: 4, diceValue: 6 } }], activation: { activationType: 1 } } },
      { prepared: true, definition: { name: 'Cure Wounds', level: 1, range: { origin: 'Touch' }, modifiers: [{ type: 'bonus', subType: 'hit-points', usePrimaryStat: true, die: { diceCount: 1, diceValue: 8 } }], activation: { activationType: 1 } } },
      { prepared: false, definition: { name: 'Inflict Wounds', level: 1, requiresAttackRoll: true, range: { origin: 'Touch' }, modifiers: [{ type: 'damage', subType: 'necrotic', die: { diceCount: 3, diceValue: 10 } }] } },
      { definition: { name: 'Sacred Flame', level: 0, requiresSavingThrow: true, saveDcAbilityId: 2, range: { origin: 'Ranged', rangeValue: 60 }, modifiers: [{ type: 'damage', subType: 'radiant', die: { diceCount: 1, diceValue: 8 } }] } },
    ] }],
    spells: {}, conditions: [{ id: 11, level: null }], deathSaves: { failCount: 0, successCount: 0 }, currencies: { gp: 15, sp: 5, pp: 1 },
  },
};

test('D&D Beyond import derives the numbers a sheet shows', () => {
  const ch = parseDdbCharacter(DDB);
  assert.equal(ch.name, 'Thalia');
  assert.equal(ch.level, 3);
  assert.equal(ch.abilities.con, 16);
  assert.equal(ch.abilities.wis, 16);
  assert.equal(ch.maxHp, 20 + 3 * 3 + 3, 'base + CON×lvl + dwarven toughness');
  assert.equal(ch.hp, ch.maxHp - 5);
  assert.equal(ch.tempHp, 3);
  assert.equal(ch.ac, 16 + 2 + 1, 'heavy armor + shield + attuned ring; unequipped item ignored');
  assert.equal(ch.speed, 25);
  assert.equal(ch.saves.wis, 3 + 2);
  assert.equal(ch.passivePerception, 10 + 3 + 2);
  assert.deepEqual(ch.slots, [{ level: 1, max: 4, used: 1 }, { level: 2, max: 2, used: 0 }]);
  assert.equal(ch.spellDc, 13);
  assert.equal(ch.spellAttack, 5);
  assert.deepEqual(ch.conditions, ['poisoned']);
  assert.equal(ch.gold, 26);
  const names = ch.actions.map(a => a.name);
  assert.ok(names.includes('Mace') && names.includes('Guiding Bolt') && names.includes('Cure Wounds') && names.includes('Sacred Flame'));
  assert.ok(!names.includes('Inflict Wounds'), 'unprepared spells skipped for prepared casters');
  const mace = ch.actions.find(a => a.name === 'Mace');
  assert.equal(mace.bonus, 2); assert.equal(mace.damage, '1d6');
  const cure = ch.actions.find(a => a.name === 'Cure Wounds');
  assert.equal(cure.kind, 'heal'); assert.equal(cure.damage, '1d8+3'); assert.equal(cure.slot, 1);
  const flame = ch.actions.find(a => a.name === 'Sacred Flame');
  assert.equal(flame.kind, 'save'); assert.equal(flame.save, 'dex'); assert.equal(flame.dc, 13); assert.equal(flame.half, false);
  assert.equal(extractDdbId('https://www.dndbeyond.com/characters/98765432/abc'), '98765432');
  assert.throws(() => parseDdbCharacter({ hello: 1 }));
});

test('inventory: add, use, give, stash and permissions', () => {
  const s = withParty();
  const EVE = { name: 'Eve', role: 'player' };
  const potion = { id: 'p1', name: 'Potion of Healing', cat: 'consumable', qty: 3 };
  assert.equal(canApply(op({ type: 'party.item', owner: 'c1', item: potion }), PLAYER, s), true);
  assert.notEqual(canApply(op({ type: 'party.item', owner: 'c1', item: potion }), EVE, s), true);
  assert.equal(canApply(op({ type: 'party.item', owner: 'party', item: potion }), EVE, s), true, 'anyone can use the party stash');
  assert.equal(canApply(op({ type: 'party.itemMove', from: 'party', to: 'c1', itemId: 'x' }), EVE, s), true);
  assert.notEqual(canApply(op({ type: 'party.itemMove', from: 'c1', to: 'party', itemId: 'p1' }), EVE, s), true);

  applyOp(s, op({ type: 'party.item', owner: 'c1', item: potion }));
  applyOp(s, op({ type: 'party.item', owner: 'c1', item: { ...potion, qty: 2 } }));
  assert.deepEqual(s.party.chars.c1.inventory.map(i => [i.id, i.qty]), [['p1', 2]], 'upsert by id');

  // Splitting a stack into the stash, then merging into a matching stack
  applyOp(s, op({ type: 'party.itemMove', from: 'c1', to: 'party', itemId: 'p1', qty: 1 }));
  assert.equal(s.party.chars.c1.inventory[0].qty, 1);
  assert.equal(s.party.items.length, 1);
  assert.equal(s.party.items[0].cat, 'consumable', 'category survives the move');
  applyOp(s, op({ type: 'party.itemMove', from: 'c1', to: 'party', itemId: 'p1' }));
  assert.equal(s.party.chars.c1.inventory.length, 0);
  assert.deepEqual(s.party.items.map(i => i.qty), [2]);

  applyOp(s, op({ type: 'party.itemRemove', owner: 'party', itemId: s.party.items[0].id }));
  assert.equal(s.party.items.length, 0);

  // Rooms saved before inventories existed have no party.items
  delete s.party.items;
  applyOp(s, op({ type: 'party.item', owner: 'party', item: { id: 'k', name: 'Crypt key', cat: 'quest', qty: 1 } }));
  assert.equal(s.party.items[0].name, 'Crypt key');
});

test('D&D Beyond inventory import is categorized and re-sync keeps table-added items', () => {
  const ch = parseDdbCharacter(DDB);
  const cat = name => ch.inventory.find(i => i.name === name)?.cat;
  assert.equal(cat('Chain Mail'), 'armor');
  assert.equal(cat('Shield'), 'armor');
  assert.equal(cat('Mace'), 'weapon');
  assert.equal(cat('Ring of Protection'), 'gear');
  assert.ok(ch.inventory.find(i => i.name === 'Chain Mail').equipped);

  const s = initialState();
  applyOp(s, op({ type: 'party.upsertChar', char: ch }));
  applyOp(s, op({ type: 'party.item', owner: ch.id, item: { id: 'mine', name: 'Strange idol', cat: 'quest', qty: 1 } }));
  applyOp(s, op({ type: 'party.upsertChar', char: parseDdbCharacter(DDB), keepLive: true }));
  const inv = s.party.chars[ch.id].inventory;
  assert.equal(inv.filter(i => i.name === 'Mace').length, 1, 'imported gear replaced, not duplicated');
  assert.ok(inv.some(i => i.id === 'mine'));

  // Saving from the sheet editor (no inventory field) keeps the bag
  const { inventory, ...rest } = s.party.chars[ch.id];
  applyOp(s, op({ type: 'party.upsertChar', char: { ...rest, ac: 20 } }));
  assert.equal(s.party.chars[ch.id].inventory.length, inv.length);
});

test('turn order skips the dead', () => {
  const s = withParty();
  applyOp(s, op({ type: 'battle.addToken', token: { id: 'gob2', name: 'Goblin 2', col: 3, row: 1, hp: 7, maxHp: 7, conditions: [] } }));
  applyOp(s, op({ type: 'battle.combatStart', encId: 'e', order: [{ id: 'pc', init: 20 }, { id: 'gob', init: 15 }, { id: 'gob2', init: 10 }] }));
  applyOp(s, op({ type: 'battle.action', actorId: 'pc', action: { name: 'Stab', kind: 'melee' }, results: [{ targetId: 'gob', hit: true, damage: 20 }] }));
  applyOp(s, op({ type: 'battle.combatNext' }));
  assert.equal(s.battle.combat.order[s.battle.combat.turn].id, 'gob2');
  applyOp(s, op({ type: 'battle.combatNext' }));
  assert.equal(s.battle.combat.order[s.battle.combat.turn].id, 'pc');
  assert.equal(s.battle.combat.round, 2);
});

import { computeCover, withManualCover } from '../public/js/core/cover.js';
import { makeCells } from '../public/js/core/ops.js';
import { reachable, buildPath, cellKey } from '../public/js/views/pathing.js';

function coverMap(features = {}, walls = []) {
  const map = { width: 12, height: 8, cells: makeCells(12, 8) };
  for (const [k, f] of Object.entries(features)) { const [c, r] = k.split(',').map(Number); map.cells[r][c].feature = f; }
  for (const [c, r] of walls) map.cells[r][c].elevation = 4;
  return map;
}
const A = { id: 'a', col: 1, row: 3, size: 1 };
const T = { id: 't', col: 6, row: 3, size: 1 };

test('cover: open ground, obstacles, walls and creatures', () => {
  assert.equal(computeCover(coverMap(), { from: A, target: T }), 'none');
  assert.equal(computeCover(coverMap({ '5,3': 'crate' }), { from: A, target: T }), 'half', 'crate caps at half');
  assert.equal(computeCover(coverMap({ '5,3': 'pillar' }), { from: A, target: T }), 'three', 'pillar directly between');
  assert.equal(computeCover(coverMap({}, [[4, 2], [4, 3], [4, 4]]), { from: A, target: T }), 'total', 'wall blocks sight');
  assert.equal(computeCover(coverMap({ '4,3': 'door' }), { from: A, target: T }), 'total', 'closed door in the same row blocks every line');
  assert.equal(computeCover(coverMap({ '4,3': 'doorOpen' }), { from: A, target: T }), 'none', 'open door does not');
  assert.equal(computeCover(coverMap({}, [[4, 3]]), { from: { id: 'a', col: 1, row: 1 }, target: T }), 'half', 'a lone wall square seen at an angle');
  assert.equal(computeCover(coverMap({}), { from: A, target: T, others: [{ id: 'x', col: 4, row: 3 }] }), 'half', 'creature in the way');
  assert.equal(computeCover(coverMap({ '5,1': 'pillar' }), { from: A, target: T }), 'none', 'obstacle off the line');
  // The attacker's own square never counts
  assert.equal(computeCover(coverMap({ '1,3': 'crate' }), { from: A, target: T }), 'none');
  // AoE from a point: walls between point and target shield it
  assert.equal(computeCover(coverMap({}, [[4, 2], [4, 3], [4, 4]]), { from: { id: 'o', col: 2, row: 3 }, point: [2.5, 3.5], target: T }), 'total');
  assert.equal(withManualCover('none', ['half cover']), 'half');
  assert.equal(withManualCover('half', ['three-quarters cover']), 'three');
  assert.equal(withManualCover('three', ['half cover']), 'three');
});

test('cover raises AC and DEX saves when the reducer resolves an action', () => {
  const s = withParty();
  s.battle.tokens.gob.saves = { dex: 1, wis: 1 };
  s.battle.tokens.gob.hp = 999; s.battle.tokens.gob.maxHp = 999;
  const atk = op({ type: 'battle.action', actorId: 'pc', action: { name: 'Bow', kind: 'ranged' }, results: [{ targetId: 'gob', cover: 'three', attack: { rolls: [10], value: 10, bonus: 9, total: 19 }, dmgRoll: 4 }] });
  applyOp(s, atk);
  assert.equal(atk.results[0].ac, 20);
  assert.equal(atk.results[0].hit, false, '19 misses AC 15 + 5');
  const fb = op({ type: 'battle.action', actorId: 'pc', action: { name: 'Fireball', kind: 'save', half: true }, results: [{ targetId: 'gob', cover: 'half', save: { ability: 'dex', dc: 15, d20: 11 }, dmgRoll: 20 }] });
  applyOp(s, fb);
  assert.equal(fb.results[0].save.bonus, 3);
  assert.equal(fb.results[0].save.success, false);
  assert.equal(fb.results[0].damage, 20);
  const r = resolveAction({ id: 'pc' }, { name: 'Fear', kind: 'save', save: 'wis', dc: 15, damage: '' }, [{ id: 'gob', name: 'G', cover: 'half' }]);
  assert.equal(r.results[0].cover, undefined, 'cover only helps DEX saves');
});

test('players never receive monster HP, AC or saves', () => {
  const s = withParty();
  s.battle.tokens.gob.saves = { dex: 2 };
  // Initial sync
  const view = redactSection('battle', s.battle, s);
  assert.deepEqual(Object.keys(view.tokens.gob).filter(k => ['hp', 'maxHp', 'ac', 'saves', 'actions'].includes(k)), []);
  assert.equal(view.tokens.gob.health, 'unhurt');
  assert.equal(view.tokens.pc.charId, 'c1', 'PC tokens untouched');
  // An attack on the goblin
  const atk = op({ type: 'battle.action', actorId: 'pc', action: { name: 'Bow', kind: 'ranged' }, results: [{ targetId: 'gob', attack: { rolls: [12], value: 12, bonus: 5, total: 17 }, dmgRoll: 4 }] }, 'Pat');
  applyOp(s, atk);
  const msgs = playerMessages(atk, {}, s);
  assert.equal(msgs[0].op.fx, true);
  assert.equal(msgs[0].op.results[0].ac, undefined);
  assert.equal(msgs[0].op.results[0].hit, true);
  assert.equal(msgs[1].type, 'patch');
  assert.equal(msgs[1].tokens.gob.hp, undefined);
  assert.equal(msgs[1].tokens.gob.health, 'bloodied');
  assert.ok(!msgs[1].log[0].text.includes('AC'), 'log omits monster AC: ' + msgs[1].log[0].text);
  // DM edits a monster's HP: players get a stat-free token
  const edit = op({ type: 'battle.updateToken', id: 'gob', patch: { hp: 1 } });
  const before = inspectBefore(edit, s);
  applyOp(s, edit);
  const m = playerMessages(edit, before, s)[0].op;
  assert.equal(m.type, 'battle.setTokens');
  assert.equal(m.tokens.gob.hp, undefined);
  assert.equal(m.tokens.gob.health, 'critical');
  // Attacks on a PC still show AC to everyone
  const hitPc = op({ type: 'battle.action', actorId: 'gob', action: { name: 'Scimitar', kind: 'melee' }, results: [{ targetId: 'pc', attack: { rolls: [15], value: 15, bonus: 4, total: 19 }, dmgRoll: 3 }] });
  applyOp(s, hitPc);
  assert.ok(s.log.at(-1).text.includes('vs AC 15'));
  // fx copies change nothing when applied
  const before2 = JSON.stringify(s);
  applyOp(s, { ...msgs[0].op, id: 'fx1' });
  assert.equal(JSON.stringify(s), before2);
});

test('blocking obstacles stop movement; low ones are difficult terrain', () => {
  const map = coverMap({ '2,3': 'pillar', '2,4': 'crate' });
  const { dist } = reachable(map, [1, 3], 100, new Map());
  assert.equal(dist.get(cellKey(2, 3)), undefined);
  assert.equal(dist.get(cellKey(2, 4)), 10);
});

test('room answers hit / miss for a player roll without revealing AC', () => {
  const s = withParty();  // goblin AC 15
  const at = (value, total, cover) => checkAttack(s, { targetId: 'gob', cover, attack: { value, total } });
  assert.deepEqual(at(10, 15), { hit: true, crit: false });
  assert.deepEqual(at(10, 14), { hit: false, crit: false });
  assert.deepEqual(at(10, 16, 'half'), { hit: false, crit: false }, 'half cover: +2 AC');
  assert.deepEqual(at(20, 21), { hit: true, crit: true });
  assert.deepEqual(at(1, 40), { hit: false, crit: false });
});

test('paths on open ground run straight, not off at an angle', () => {
  const map = coverMap();
  const go = (from, to) => buildPath(reachable(map, from, 1000, new Map()), from, to);
  assert.deepEqual(go([1, 3], [6, 3]), [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3]]);
  assert.deepEqual(go([2, 1], [2, 6]).map(p => p[0]), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(go([0, 0], [4, 4]), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  // Shallow line: one diagonal somewhere, never drifting more than half a square
  const p = go([0, 0], [6, 2]);
  assert.equal(p.length, 7, 'still the cheapest route (30 ft)');
  for (const [c, r] of p) assert.ok(Math.abs(r - c / 3) <= 0.67, `(${c},${r}) hugs the line`);
  // Obstacles still force a detour
  const walled = coverMap({}, [[3, 2], [3, 3], [3, 4]]);
  const detour = buildPath(reachable(walled, [1, 3], 1000, new Map()), [1, 3], [5, 3]);
  assert.ok(detour.every(([c, r]) => !(c === 3 && r >= 2 && r <= 4)));
});

import { monsterArt, monsterArtUrl } from '../public/js/constants.js';

test('monster portraits match token names, with overrides', () => {
  assert.equal(monsterArtUrl({ name: 'Goblin' }), 'img/monsters/goblin.jpg');
  assert.equal(monsterArtUrl({ name: 'Goblin 3' }), 'img/monsters/goblin.jpg', 'numbered copies share art');
  assert.equal(monsterArtUrl({ name: 'Vampire Spawn 2' }), 'img/monsters/vampire-spawn.jpg');
  assert.equal(monsterArtUrl({ name: 'Owlbear' }), null);
  assert.equal(monsterArtUrl({ name: 'Strahd', art: 'vampire' }), 'img/monsters/vampire.jpg');
  assert.equal(monsterArtUrl({ name: 'Lich', art: 'none' }), null);
  assert.equal(monsterArtUrl({ name: 'Goblin', charId: 'c1' }), null, 'player characters never get monster art');
  assert.equal(monsterArt({ name: 'Skeleton Archer 2' }).scene, true);
  assert.equal(monsterArt({ name: 'Skeleton' }).scene, false);
});

test('hiding and revealing a monster updates what players receive', () => {
  const s = withParty();
  const send = patch => {
    const o = op({ type: 'battle.updateToken', id: 'gob', patch });
    const before = inspectBefore(o, s);
    applyOp(s, o);
    return playerMessages(o, before, s);
  };
  assert.equal(send({ hidden: true })[0].op.type, 'battle.removeToken', 'players lose the hidden token');
  assert.ok(!redactState(s).battle.tokens.gob);
  const reveal = send({ hidden: false })[0].op;
  assert.equal(reveal.type, 'battle.setTokens', 'players get the revealed token back');
  assert.equal(reveal.tokens.gob.redacted, true, 'still without its stat block');
});

test('players see "Something attacks …" when a hidden creature acts', () => {
  const s = withParty();
  applyOp(s, op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: true } }));
  const o = op({ type: 'battle.action', actorId: 'gob', action: { name: 'Scimitar', kind: 'melee', dmgType: 'slashing' },
    results: [{ targetId: 'pc', hit: true, ac: 15, attack: { rolls: [14], value: 14, bonus: 4, total: 18 }, damage: 25 }] });
  applyOp(s, o);

  const dmLine = s.log.find(l => l.kind === 'attack');
  assert.match(dmLine.text, /^Goblin uses Scimitar: Aria/, 'the DM still sees who attacked');

  const patch = playerMessages(o, {}, s).find(m => m.type === 'patch');
  const texts = patch.log.map(l => l.text).join('\n');
  assert.match(texts, /^Something attacks Aria \(18 vs AC 15: hit\) — 25 slashing — DOWNED/m);
  assert.ok(!texts.includes('Goblin'), 'live update never names the hidden attacker');
  assert.ok(!JSON.stringify(redactState(s).log).includes('Goblin'), 'nor does a fresh sync');
  assert.ok(!JSON.stringify(patch.log).includes('playerText'));

  // Once revealed, new attacks name it again
  applyOp(s, op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: false } }));
  const o2 = op({ type: 'battle.action', actorId: 'gob', action: { name: 'Scimitar', kind: 'melee' }, results: [{ targetId: 'pc', hit: false }] });
  applyOp(s, o2);
  assert.match(playerMessages(o2, {}, s).find(m => m.type === 'patch').log[0].text, /^Goblin uses Scimitar/);
});

test('a hidden creature acting only on hidden creatures leaves no trace for players', () => {
  const s = withParty();
  applyOp(s, op({ type: 'battle.addToken', token: { id: 'sham', name: 'Goblin Shaman', col: 5, row: 5, hp: 9, maxHp: 9, conditions: [], hidden: true } }));
  applyOp(s, op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: true, hp: 2 } }));
  const o = op({ type: 'battle.action', actorId: 'sham', action: { name: 'Cure Wounds', kind: 'heal' }, results: [{ targetId: 'gob', heal: 5 }] });
  applyOp(s, o);
  assert.ok(s.log.at(-1).text.startsWith('Goblin Shaman heals with Cure Wounds'));
  assert.deepEqual(playerMessages(o, {}, s).find(m => m.type === 'patch').log, []);
  assert.ok(!JSON.stringify(redactState(s).log).includes('Shaman'));
});

import { areaOf, aimedFromSelf, creaturesInArea } from '../public/js/core/aoe.js';
import { computeVision, lightSources, canSee } from '../public/js/core/vision.js';
import { addDice, upcastAction } from '../public/js/core/actions.js';

test('cone, line and cube areas follow the 5e grid rules', () => {
  const caster = { col: 2, row: 5, size: 1 };
  const cone = areaOf({ radius: 15, shape: 'cone' }, caster, [8, 5]);
  assert.ok(cone.test(3, 5) && cone.test(5, 4) && cone.test(5, 6), 'widens with distance');
  assert.ok(!cone.test(3, 4), 'not wider than it is long');
  assert.ok(!cone.test(6, 5), 'stops at 15 ft');
  assert.ok(!cone.test(2, 5) && !cone.test(1, 5), "not the caster's own space or behind it");

  const line = areaOf({ radius: 30, shape: 'line' }, caster, [9, 5]);
  assert.deepEqual([3, 4, 5, 6, 7, 8, 9].map(c => line.test(c, 5)), [true, true, true, true, true, true, false]);
  assert.ok(!line.test(4, 4), '5 ft wide');

  const cube = areaOf({ radius: 15, shape: 'cube', range: 15 }, caster, [8, 5]);
  const cells = [];
  for (let r = 0; r < 11; r++) for (let c = 0; c < 12; c++) if (cube.test(c, r)) cells.push(`${c},${r}`);
  assert.deepEqual(cells, ['3,4', '4,4', '5,4', '3,5', '4,5', '5,5', '3,6', '4,6', '5,6'], 'flush against the caster');

  assert.equal(aimedFromSelf({ shape: 'cone' }), true);
  assert.equal(aimedFromSelf({ shape: 'cube', range: 60, radius: 10 }), false);
  const big = { id: 'ogre', col: 4, row: 6, size: 2 };
  assert.deepEqual(creaturesInArea(cone, [big, { id: 'far', col: 10, row: 5 }]).map(t => t.id), ['ogre'], 'any cell of a large creature counts');
  assert.ok(areaOf({ radius: 20 }, caster, [5, 5]).test(5, 9) && !areaOf({ radius: 20 }, caster, [5, 5]).test(5, 10), 'circles unchanged');
});

test('line of sight and lighting', () => {
  const map = { width: 12, height: 7, cells: makeCells(12, 7), vision: { mode: 'los' } };
  for (let r = 0; r < 7; r++) map.cells[r][6].elevation = 4;   // a wall down column 6…
  map.cells[3][6] = { terrain: 'stone', elevation: 0, feature: 'door' };   // …with a closed door in a gap
  const at = (vis, c, r) => vis[r * 12 + c];
  let vis = computeVision(map, [{ x: 2.5, y: 3.5 }], []);
  assert.equal(at(vis, 6, 2), 2, 'you can see the wall itself');
  assert.equal(at(vis, 8, 3), 0, 'but not past a closed door');
  map.cells[3][6].feature = 'doorOpen';
  vis = computeVision(map, [{ x: 2.5, y: 3.5 }], []);
  assert.equal(at(vis, 8, 3), 2, 'an open door lets sight through');
  assert.equal(at(vis, 8, 0), 0, 'only through the gap');

  map.vision = { mode: 'light', ambient: 'dark' };
  map.cells[3][10].feature = 'torch';
  const lights = lightSources(map, []);
  vis = computeVision(map, [{ x: 2.5, y: 3.5 }], lights);
  assert.equal(at(vis, 9, 3), 2, 'torchlight is bright within 20 ft');
  assert.equal(at(vis, 3, 3), 1, 'dim light spills 40 ft through the open door');
  assert.equal(at(vis, 1, 1), 0, 'darkness hides even nearby cells');
  vis = computeVision(map, [{ x: 2.5, y: 3.5, darkvision: 60 }], lights);
  assert.equal(at(vis, 1, 1), 1, 'darkvision sees darkness as dim');
  assert.equal(at(vis, 3, 3), 2, '…and dim light as bright');
  map.cells[3][3].feature = 'darkness';
  vis = computeVision(map, [{ x: 2.5, y: 3.5, darkvision: 60 }], lights);
  assert.equal(at(vis, 3, 3), 0, 'but not magical darkness');
  assert.equal(at(vis, 9, 3), 0, 'which also blocks sight past it');
  assert.equal(canSee(map, 2.5, 3.5, 2, 3), true);

  map.vision = { mode: 'off' };
  assert.ok(computeVision(map, [], []).every(v => v === 2), 'off: everything visible');
  map.vision = { mode: 'los' };
  assert.ok(computeVision(map, [], []).every(v => v === 0), 'no one on the map sees nothing');
});

test('upcasting adds dice and targets per slot level', () => {
  assert.equal(addDice('8d6', '1d6', 2), '10d6');
  assert.equal(addDice('3d8+3', '1d8', 1), '4d8+3');
  assert.equal(addDice('1d4+1', '1d6', 1), '1d4+1+1d6');
  const fb = parseActionLine('Fireball | save:dex | 15 | 8d6 fire | 150 | 20 | slot:3, up:1d6');
  const at5 = upcastAction(fb, 5);
  assert.equal(at5.damage, '10d6'); assert.equal(at5.slot, 5); assert.equal(at5.name, 'Fireball (5th)');
  assert.equal(upcastAction(fb, 3), fb, 'base level is unchanged');
  const mm = parseActionLine('Magic Missile | auto | 0 | 1d4+1 force | 120 | | slot:1, targets:3, up:target');
  assert.equal(upcastAction(mm, 3).targets, 5);
  const line = parseActionLine('Breath | save:dex | 13 | 6d6 fire | 30 | 15 cone | conc');
  assert.equal(line.shape, 'cone'); assert.equal(line.conc, true);
  assert.equal(actionToLine(line), 'Breath | save:dex | 13 | 6d6 fire | 30 | 15 cone | conc');

  // The reducer spends the chosen slot
  const s = withParty();
  applyOp(s, op({ type: 'battle.action', actorId: 'pc', action: { name: 'Burning Hands (2nd)', kind: 'save', slot: 2 }, results: [] }));
  assert.equal(s.party.chars.c1.slots[0].used, 0, 'no 2nd-level slot to spend on this sheet');
  s.party.chars.c1.slots.push({ level: 2, max: 1, used: 0 });
  applyOp(s, op({ type: 'battle.action', actorId: 'pc', action: { name: 'Burning Hands (2nd)', kind: 'save', slot: 2 }, results: [] }));
  assert.equal(s.party.chars.c1.slots[1].used, 1);
});

test('concentration: casting, damage checks, saves and dropping', () => {
  const s = withParty();
  const cast = name => applyOp(s, op({ type: 'battle.action', actorId: 'pc', action: { name, kind: 'save', conc: name }, results: [] }, 'Pat'));
  cast('Hold Person');
  const aria = s.party.chars.c1;
  aria.hp = aria.maxHp = 60;
  assert.ok(aria.conditions.includes('concentrating'));
  assert.equal(aria.concentration, 'Hold Person');

  cast('Moonbeam');
  assert.equal(aria.concentration, 'Moonbeam');
  assert.ok(s.log.some(l => l.text === 'Aria stops concentrating on Hold Person.'), 'a new concentration spell ends the old one');

  applyOp(s, op({ type: 'battle.action', actorId: 'gob', action: { name: 'Scimitar', kind: 'melee' }, results: [{ targetId: 'pc', hit: true, damage: 4 }] }));
  applyOp(s, op({ type: 'party.hp', id: 'c1', mode: 'damage', amount: 24 }));
  assert.ok(aria.hp > 0);
  assert.deepEqual(aria.concChecks, [10, 12], 'DC is 10 or half the damage, one check per hit');
  assert.ok(s.log.some(l => l.kind === 'conc' && l.text.includes('DC 12 Constitution save to keep concentrating on Moonbeam')));

  const check = (d20, bonus = 2) => op({ type: 'battle.concentration', tokenId: 'pc', d20, bonus }, 'Pat');
  assert.equal(canApply(check(10), PLAYER, s), true);
  assert.notEqual(canApply(check(10), { name: 'Eve', role: 'player' }, s), true);
  applyOp(s, check(9));
  assert.deepEqual(aria.concChecks, [12], '11 beats DC 10');
  applyOp(s, check(5));
  assert.ok(!aria.conditions.includes('concentrating'), '7 fails DC 12');
  assert.equal(aria.concentration, null);
  assert.ok(s.stats.dice.Pat.d20s >= 2, 'concentration saves count toward dice stats');

  cast('Bless');
  applyOp(s, op({ type: 'battle.concentration', charId: 'c1', drop: true }, 'Pat'));
  assert.ok(!aria.conditions.includes('concentrating'));

  cast('Bless');
  applyOp(s, op({ type: 'party.hp', id: 'c1', mode: 'damage', amount: 999 }));
  assert.ok(!aria.conditions.includes('concentrating'), 'dropping to 0 HP ends concentration');
  assert.ok(s.log.some(l => l.text === 'Aria loses concentration on Bless.'));
});

test('a hidden caster keeps its concentration out of the players\' log', () => {
  const s = withParty();
  applyOp(s, op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: true } }));
  applyOp(s, op({ type: 'battle.action', actorId: 'gob', action: { name: 'Hex', kind: 'auto', conc: 'Hex' }, results: [] }));
  applyOp(s, op({ type: 'battle.action', actorId: 'gob', action: { name: 'Web', kind: 'auto', conc: 'Web' }, results: [] }));
  applyOp(s, op({ type: 'battle.concentration', tokenId: 'gob', drop: true }));
  assert.ok(s.log.some(l => l.text.includes('Goblin stops concentrating')));
  assert.ok(!JSON.stringify(redactState(s).log).includes('Goblin'));
});

test('DM sets vision per map; it survives a resize and is saved with the map', () => {
  const s = initialState();
  const set = op({ type: 'battle.setVision', vision: { mode: 'light', ambient: 'dim' } });
  assert.notEqual(canApply(set, PLAYER, s), true);
  applyOp(s, set);
  applyOp(s, op({ type: 'battle.setMap', map: { width: 30, height: 20, cells: [] } }));
  assert.deepEqual(s.map.vision, { mode: 'light', ambient: 'dim' });
  applyOp(s, op({ type: 'battle.saveMap', name: 'Crypt' }));
  applyOp(s, op({ type: 'battle.setVision', vision: { mode: 'off' } }));
  applyOp(s, op({ type: 'battle.loadMap', name: 'Crypt' }));
  assert.equal(s.map.vision.mode, 'light');
});

test('cond: flags apply conditions on a failed save or a hit', () => {
  const s = withParty();
  const blind = parseActionLine('Blindness/Deafness | save:con | 13 | | 30 | | slot:2, up:target, cond:blinded');
  assert.deepEqual(blind.conds, ['blinded']);
  assert.equal(actionToLine(blind), 'Blindness/Deafness | save:con | 13 | | 30 | | slot:2, up:target, cond:blinded');
  const fire = parseActionLine('Faerie Fire | save:dex | 13 | | 60 | 20 cube | slot:1, conc, cond:outlined');
  assert.equal(fire.shape, 'cube'); assert.equal(fire.conc, true); assert.deepEqual(fire.conds, ['outlined']);

  const cast = (action, results) => applyOp(s, op({ type: 'battle.action', actorId: 'pc', action, results }, 'Pat'));
  const opOf = a => ({ name: a.name, kind: a.kind, conds: a.conds });
  // Goblin has no CON save bonus: 5 fails DC 13, 15 saves
  cast(opOf(blind), [{ targetId: 'gob', save: { ability: 'con', dc: 13, d20: 15 } }]);
  assert.ok(!s.battle.tokens.gob.conditions.includes('blinded'), 'a successful save avoids it');
  cast(opOf(blind), [{ targetId: 'gob', save: { ability: 'con', dc: 13, d20: 5 } }]);
  assert.ok(s.battle.tokens.gob.conditions.includes('blinded'));
  assert.match(s.log.at(-1).text, /Goblin \(CON save 5 vs DC 13: failed\) — blinded/);

  // Attacks apply it on a hit only, alongside damage
  const trip = parseActionLine('Trip Attack | melee | 5 | 1d8+3 slashing | 5 | | cond:prone');
  cast(opOf(trip), [{ targetId: 'gob', ac: 15, attack: { rolls: [3], value: 3, bonus: 5, total: 8 }, dmgRoll: 6 }]);
  assert.ok(!s.battle.tokens.gob.conditions.includes('prone'), 'a miss does nothing');
  cast(opOf(trip), [{ targetId: 'gob', ac: 15, attack: { rolls: [14], value: 14, bonus: 5, total: 19 }, dmgRoll: 2 }]);
  assert.ok(s.battle.tokens.gob.conditions.includes('prone'));

  // A hidden target's condition stays out of players' log like its name
  applyOp(s, op({ type: 'battle.updateToken', id: 'gob', patch: { hidden: true } }));
  cast(opOf(fire), [{ targetId: 'gob', save: { ability: 'dex', dc: 13, d20: 2 } }]);
  assert.ok(s.battle.tokens.gob.conditions.includes('outlined'));
  assert.ok(!JSON.stringify(redactState(s).log).includes('outlined'));
});
