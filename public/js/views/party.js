// ============================================================
// Party overview — character cards with live HP, slots,
// conditions, death saves; D&D Beyond import & re-sync
// ============================================================

import { store, subscribe, dispatch, isDM } from '../store.js';
import { parseDdbCharacter, extractDdbId, blankCharacter } from '../core/ddb.js';
import { parseActionText, actionsToText } from '../core/actions.js';
import { abilityMod, fmtMod, ABILITIES } from '../core/util.js';
import { CONDITIONS } from '../constants.js';
import { h, toast, openModal, confirmDialog, promptDialog, field, pickFile } from '../ui/dom.js';
import { fetchDdb } from '../net.js';
import { openInventory } from './inventory.js';
import { rollConcentration } from './battle.js';

let root;

export function mountParty(el) {
  root = el;
  subscribe(changed => {
    if (changed.has('*') || changed.has('party') || changed.has('battle') || changed.has('presence')) render();
  });
}

const owns = ch => isDM() || ch.player === store.me?.name;

function render() {
  if (!store.state || !root) return;
  const chars = Object.values(store.state.party.chars).sort((a, b) => a.name.localeCompare(b.name));
  root.innerHTML = '';

  const totalHp = chars.reduce((s, c) => s + Math.max(0, c.hp), 0);
  const totalMax = chars.reduce((s, c) => s + c.maxHp, 0);
  const avgLvl = chars.length ? (chars.reduce((s, c) => s + (c.level || 1), 0) / chars.length) : 0;

  root.append(h('div', { class: 'page-head' },
    h('div', {},
      h('h2', {}, 'The Party'),
      chars.length ? h('p', { class: 'muted' }, `${chars.length} adventurer${chars.length === 1 ? '' : 's'} · avg level ${avgLvl.toFixed(1)} · ${totalHp}/${totalMax} HP total`) : null),
    h('div', { class: 'row' },
      h('button', { class: 'btn bag-btn', onclick: () => openInventory(), title: 'Party inventory' }, '🎒 Inventory'),
      h('button', { class: 'btn primary', onclick: openImport }, '⬇ Import from D&D Beyond'),
      h('button', { class: 'btn', onclick: () => openEditor(blankCharacter(store.me.name + "'s hero"), true) }, '＋ Add manually'),
      isDM() && chars.length ? h('button', { class: 'btn', onclick: () => partyRest('short') }, '☕ Short rest') : null,
      isDM() && chars.length ? h('button', { class: 'btn', onclick: () => partyRest('long') }, '🌙 Long rest') : null)));

  if (!chars.length) {
    root.append(h('div', { class: 'empty' },
      h('div', { class: 'big-icon' }, '🧙'),
      h('h3', {}, 'No adventurers yet'),
      h('p', {}, 'Each player can import their D&D Beyond character — paste the character link (sheet must be set to Public) or upload the JSON.')));
    return;
  }
  root.append(h('div', { class: 'char-grid' }, chars.map(card)));
}

async function partyRest(kind) {
  if (!await confirmDialog(kind === 'long'
    ? 'Long rest: restore everyone to full HP and refresh all spell slots?'
    : 'Short rest: refresh warlock pact slots? (Players can spend hit dice on their own card.)', 'Rest')) return;
  dispatch({ type: 'party.rest', id: 'all', kind });
}

// ------------------------------------------------------------
// Card
// ------------------------------------------------------------

function card(ch) {
  const mine = owns(ch);
  const pct = ch.maxHp ? Math.max(0, Math.min(1, ch.hp / ch.maxHp)) : 0;
  const cls = (ch.classes || []).map(c => `${c.name}${c.subclass ? ` (${c.subclass})` : ''} ${c.level}`).join(' / ');
  const dead = (ch.conditions || []).includes('dead');
  const onMap = Object.values(store.state.battle.tokens).some(t => t.charId === ch.id);
  const online = store.users.some(u => u.name === ch.player);

  const amount = h('input', { type: 'number', min: 1, value: '', placeholder: '#', class: 'hp-amt' });
  const hpAct = mode => () => {
    const n = parseInt(amount.value, 10);
    if (!n || n < 1) { amount.focus(); return; }
    dispatch({ type: 'party.hp', id: ch.id, mode, amount: n });
    amount.value = '';
  };

  return h('div', { class: 'char-card' + (dead ? ' dead' : '') + (ch.hp <= 0 && !dead ? ' down' : ''), style: { '--accent-c': ch.color || '#2e6b8a' } },
    h('div', { class: 'cc-head' },
      h('div', { class: 'cc-avatar', style: { background: ch.color } }, ch.avatar ? h('img', { src: ch.avatar, alt: '', onerror: e => e.target.replaceWith(ch.name.slice(0, 2).toUpperCase()) }) : ch.name.slice(0, 2).toUpperCase()),
      h('div', { class: 'grow' },
        h('div', { class: 'cc-name' }, ch.name, ch.inspiration ? h('span', { class: 'insp', title: 'Inspiration' }, '★') : null),
        h('div', { class: 'cc-sub' }, [ch.race, cls].filter(Boolean).join(' · ')),
        h('div', { class: 'cc-player' },
          ch.player ? h('span', { class: 'tag' + (online ? ' online' : '') }, (online ? '● ' : '') + ch.player) : null,
          !ch.player && !isDM() ? h('button', { class: 'btn tiny', onclick: () => dispatch({ type: 'party.claim', id: ch.id }) }, 'This is mine') : null)),
      h('div', { class: 'cc-level' }, h('small', {}, 'LVL'), h('b', {}, ch.level || 1))),

    h('div', { class: 'cc-hp' },
      h('div', { class: 'hpbar' },
        h('div', { class: 'fill', style: { width: pct * 100 + '%', background: pct > 0.6 ? '#2ecc71' : pct > 0.3 ? '#e67e22' : '#e74c3c' } }),
        ch.tempHp ? h('div', { class: 'temp', style: { width: Math.min(100, ch.tempHp / ch.maxHp * 100) + '%' } }) : null,
        h('span', {}, `${ch.hp} / ${ch.maxHp}${ch.tempHp ? ` (+${ch.tempHp})` : ''}`)),
      mine ? h('div', { class: 'hp-ctl' },
        h('button', { class: 'btn tiny danger', onclick: hpAct('damage'), title: 'Take damage' }, '− Dmg'),
        amount,
        h('button', { class: 'btn tiny good', onclick: hpAct('heal'), title: 'Heal' }, '+ Heal'),
        h('button', { class: 'btn tiny', onclick: hpAct('temp'), title: 'Temporary HP' }, 'Temp')) : null),

    h('div', { class: 'cc-stats' },
      stat('AC', ch.ac), stat('Speed', ch.speed), stat('Init', fmtMod(ch.initBonus || 0)), stat('Passive', ch.passivePerception),
      stat('Prof', fmtMod(ch.profBonus || 2)), ch.spellDc ? stat('Spell DC', ch.spellDc) : null),

    h('div', { class: 'cc-abilities' }, ABILITIES.map(k => h('div', { class: 'ab' },
      h('small', {}, k.toUpperCase()), h('b', {}, fmtMod(abilityMod(ch.abilities?.[k]))), h('span', {}, ch.abilities?.[k] ?? 10)))),

    slotsBlock(ch, mine),

    ch.hp <= 0 && !dead ? deathSaves(ch, mine) : null,

    (ch.conditions || []).includes('concentrating') ? h('div', { class: 'hb-conc' + (ch.concChecks?.length ? ' check' : '') },
      h('span', {}, '🔮 ', ch.concentration || 'Concentrating'),
      mine && ch.concChecks?.length ? h('button', { class: 'btn tiny primary', onclick: () => rollConcentration(ch, ch.id) }, `Roll CON save · DC ${ch.concChecks[0]}`) : null,
      mine ? h('button', { class: 'icon-btn', title: 'Stop concentrating', onclick: () => dispatch({ type: 'battle.concentration', charId: ch.id, drop: true }) }, '✕') : null) : null,

    h('div', { class: 'chips' },
      (ch.conditions || []).filter(c => c !== 'concentrating').map(c => h('span', { class: 'chip on' + (c === 'dead' ? ' bad' : '') }, c,
        mine ? h('button', { class: 'x', onclick: () => dispatch({ type: 'party.updateChar', id: ch.id, patch: { conditions: ch.conditions.filter(x => x !== c) } }) }, '×') : null)),
      mine ? h('select', { class: 'chip-add', onchange: e => {
        if (!e.target.value) return;
        dispatch({ type: 'party.updateChar', id: ch.id, patch: { conditions: [...new Set([...(ch.conditions || []), e.target.value])] } });
      } }, h('option', { value: '' }, '+ condition'), CONDITIONS.filter(c => !(ch.conditions || []).includes(c)).map(c => h('option', { value: c }, c))) : null),

    h('div', { class: 'cc-foot' },
      mine ? h('button', { class: 'btn tiny', onclick: () => dispatch({ type: 'party.updateChar', id: ch.id, patch: { inspiration: !ch.inspiration } }) }, ch.inspiration ? '★ Inspired' : '☆ Inspiration') : null,
      mine && ch.ddbId ? h('button', { class: 'btn tiny', onclick: () => resync(ch) }, '⟳ Sync DDB') : null,
      mine ? h('button', { class: 'btn tiny', onclick: () => shortRest(ch) }, '☕ Short rest') : null,
      mine ? h('button', { class: 'btn tiny', onclick: () => openEditor(ch, false) }, '✎ Edit') : null,
      h('button', { class: 'btn tiny', onclick: () => openInventory(ch.id), title: `${ch.name}'s inventory` }, `🎒 ${(ch.inventory || []).length}`),
      onMap ? h('span', { class: 'tag' }, 'on map') : null,
      isDM() ? h('button', { class: 'btn tiny danger', onclick: async () => { if (await confirmDialog(`Remove ${ch.name} from the party?`, 'Remove', true)) dispatch({ type: 'party.removeChar', id: ch.id }); } }, '🗑') : null),
  );
}

const stat = (label, val) => h('div', { class: 'st' }, h('small', {}, label), h('b', {}, val ?? '—'));

function slotsBlock(ch, mine) {
  if (!ch.slots?.length && !ch.pact) return null;
  const row = (label, sl, levelKey) => h('div', { class: 'slot-row' },
    h('small', {}, label),
    Array.from({ length: sl.max }, (_, i) => {
      const avail = i < sl.max - sl.used;
      return h('button', {
        class: 'pip' + (avail ? ' on' : ''), disabled: !mine, title: avail ? 'Click to expend' : 'Click to restore',
        onclick: () => dispatch({ type: 'party.slot', id: ch.id, level: levelKey, used: avail ? sl.used + 1 : sl.used - 1 }),
      });
    }));
  return h('div', { class: 'cc-slots' },
    (ch.slots || []).map(sl => row(ordinal(sl.level), sl, sl.level)),
    ch.pact ? row(`Pact ${ordinal(ch.pact.level)}`, ch.pact, 'pact') : null);
}

const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th');

function deathSaves(ch, mine) {
  const ds = ch.deathSaves || { success: 0, fail: 0 };
  const pips = (key, cls) => Array.from({ length: 3 }, (_, i) => h('button', {
    class: 'pip ' + cls + (i < ds[key] ? ' on' : ''), disabled: !mine,
    onclick: () => dispatch({ type: 'party.updateChar', id: ch.id, patch: { deathSaves: { ...ds, [key]: i < ds[key] ? i : i + 1 } } }),
  }));
  return h('div', { class: 'cc-death' }, h('b', {}, '💀 Death saves'),
    h('span', {}, 'Success ', pips('success', 'good')), h('span', {}, 'Fail ', pips('fail', 'bad')));
}

async function shortRest(ch) {
  const val = await promptDialog(`${ch.name} — short rest`, 'HP regained from hit dice (0 for none)', '0');
  if (val === null) return;
  dispatch({ type: 'party.rest', id: ch.id, kind: 'short', heal: { [ch.id]: Math.max(0, parseInt(val, 10) || 0) } });
}

// ------------------------------------------------------------
// Import
// ------------------------------------------------------------

function importParsed(ch) {
  const existing = store.state.party.chars[ch.id];
  if (existing && !owns(existing)) { toast(`${ch.name} belongs to ${existing.player}`, true); return false; }
  if (!isDM() || !existing) ch.player = existing?.player ?? (isDM() ? null : store.me.name);
  dispatch({ type: 'party.upsertChar', char: ch, keepLive: !!existing });
  toast(existing ? `${ch.name} updated from D&D Beyond` : `${ch.name} joined the party!`);
  return true;
}

async function resync(ch) {
  try {
    const fresh = parseDdbCharacter(await fetchDdb(ch.ddbId));
    fresh.player = ch.player;
    dispatch({ type: 'party.upsertChar', char: fresh, keepLive: true });
    toast(`${ch.name} synced`);
  } catch (e) {
    toast(e.message, true);
  }
}

function openImport() {
  const url = h('input', { type: 'text', placeholder: 'https://www.dndbeyond.com/characters/12345678' });
  const paste = h('textarea', { rows: 4, placeholder: '…or paste the character JSON here', spellcheck: false });
  const status = h('p', { class: 'hint' });

  const fromUrl = async close => {
    const id = extractDdbId(url.value);
    if (!id) { status.textContent = 'Paste a character link or numeric ID.'; return false; }
    status.textContent = 'Fetching from D&D Beyond…';
    try {
      const ch = parseDdbCharacter(await fetchDdb(id));
      if (importParsed(ch)) close();
    } catch (e) { status.textContent = e.message; }
    return false;
  };

  const m = openModal({
    title: 'Import from D&D Beyond',
    wide: true,
    body: h('div', {},
      h('ol', { class: 'steps' },
        h('li', {}, 'On D&D Beyond, open your character → ', h('b', {}, 'Manage → Character Settings → Privacy: Public'), '.'),
        h('li', {}, 'Paste the character link below.')),
      field('Character link or ID', url),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => fromUrl(m.close) }, 'Fetch character')),
      h('div', { class: 'divider' }, 'or use an exported JSON file'),
      h('p', { class: 'hint' }, 'Open ', h('code', {}, 'character-service.dndbeyond.com/character/v5/character/<id>'), ' in your browser and save the page, then upload it here or paste its contents.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => {
          const file = await pickFile('.json,application/json');
          if (!file) return;
          try { if (importParsed(parseDdbCharacter(JSON.parse(await file.text())))) m.close(); } catch (e) { status.textContent = e.message; }
        } }, '📁 Upload JSON')),
      paste,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => {
        try { if (importParsed(parseDdbCharacter(JSON.parse(paste.value)))) m.close(); } catch (e) { status.textContent = e.message.includes('JSON') ? 'That is not valid JSON' : e.message; }
      } }, 'Import pasted JSON')),
      status),
  });
  url.addEventListener('keydown', e => { if (e.key === 'Enter') fromUrl(m.close); });
}

// ------------------------------------------------------------
// Manual editor
// ------------------------------------------------------------

function openEditor(ch, isNew) {
  const inp = (val, type = 'number', attrs = {}) => h('input', { type, value: val ?? '', ...attrs });
  const f = {
    name: inp(ch.name, 'text'), race: inp(ch.race, 'text'),
    classes: inp((ch.classes || []).map(c => `${c.name} ${c.level}`).join(' / '), 'text', { placeholder: 'Fighter 3 / Wizard 2' }),
    maxHp: inp(ch.maxHp), hp: inp(ch.hp), ac: inp(ch.ac), speed: inp(ch.speed, 'number', { step: 5 }), initBonus: inp(ch.initBonus),
    profBonus: inp(ch.profBonus), passivePerception: inp(ch.passivePerception), spellDc: inp(ch.spellDc ?? ''), spellAttack: inp(ch.spellAttack ?? ''),
    slots: inp((ch.slots || []).map(s => s.max).join(','), 'text', { placeholder: '4,3,2 (1st, 2nd, 3rd…)' }),
    pact: inp(ch.pact ? `${ch.pact.max}x${ch.pact.level}` : '', 'text', { placeholder: '2x3 = two 3rd-level slots' }),
    avatar: inp(ch.avatar || '', 'url', { placeholder: 'https://…' }), color: inp(ch.color || '#2e6b8a', 'color'),
    xp: inp(ch.xp || 0),
  };
  const ab = ABILITIES.map(k => inp(ch.abilities?.[k] ?? 10));
  const sv = ABILITIES.map(k => inp(ch.saves?.[k] ?? 0));
  const actions = h('textarea', { rows: 6, spellcheck: false }, actionsToText(ch.actions));

  openModal({
    title: isNew ? 'New character' : `Edit ${ch.name}`,
    wide: true,
    body: h('div', { class: 'form-grid' },
      field('Name', f.name), field('Race', f.race), h('div', { class: 'span2' }, field('Classes', f.classes)),
      field('Max HP', f.maxHp), field('Current HP', f.hp), field('AC', f.ac), field('Speed', f.speed),
      field('Initiative bonus', f.initBonus), field('Proficiency', f.profBonus), field('Passive Perception', f.passivePerception), field('XP', f.xp),
      field('Spell save DC', f.spellDc), field('Spell attack', f.spellAttack), field('Spell slots', f.slots), field('Pact slots', f.pact),
      h('div', { class: 'span2' }, h('div', { class: 'section-title' }, 'Ability scores'), h('div', { class: 'saves-row' }, ABILITIES.map((k, i) => h('label', {}, h('small', {}, k.toUpperCase()), ab[i])))),
      h('div', { class: 'span2' }, h('div', { class: 'section-title' }, 'Saving throw bonuses'), h('div', { class: 'saves-row' }, ABILITIES.map((k, i) => h('label', {}, h('small', {}, k.toUpperCase()), sv[i])))),
      field('Portrait URL', f.avatar), field('Token color', f.color),
      h('div', { class: 'span2' }, field('Attacks & spells', actions, 'Name | melee/ranged/spell/save:dex/heal/auto | to-hit or DC | damage type | range ft | area (20, 15 cone, 60 line, 10 cube) | flags (bonus, slot:N, pact, targets:N, conc, up:1d6, up:target, cond:prone)'))),
    actions: [{ label: 'Cancel' }, {
      label: 'Save', class: 'primary', onClick: () => {
        const classes = f.classes.value.split('/').map(s => s.trim()).filter(Boolean).map(s => {
          const m = s.match(/^(.*?)\s+(\d+)$/);
          return { name: m ? m[1] : s, subclass: '', level: m ? +m[2] : 1 };
        });
        const slotMaxes = f.slots.value.split(',').map(s => parseInt(s, 10)).filter(n => n > 0);
        const pm = f.pact.value.match(/(\d+)\s*x\s*(\d+)/i);
        const next = {
          ...ch,
          name: f.name.value.trim() || 'Hero', race: f.race.value.trim(), classes: classes.length ? classes : ch.classes,
          level: classes.reduce((s, c) => s + c.level, 0) || 1,
          maxHp: Math.max(1, +f.maxHp.value | 0), hp: Math.max(0, +f.hp.value | 0), ac: +f.ac.value | 0, speed: +f.speed.value | 0,
          initBonus: +f.initBonus.value | 0, profBonus: +f.profBonus.value | 0, passivePerception: +f.passivePerception.value | 0, xp: +f.xp.value | 0,
          spellDc: f.spellDc.value ? +f.spellDc.value : null, spellAttack: f.spellAttack.value ? +f.spellAttack.value : null,
          slots: slotMaxes.map((max, i) => ({ level: i + 1, max, used: Math.min(max, ch.slots?.find(s => s.level === i + 1)?.used || 0) })),
          pact: pm ? { max: +pm[1], level: +pm[2], used: Math.min(+pm[1], ch.pact?.used || 0) } : null,
          avatar: f.avatar.value.trim() || null, color: f.color.value,
          abilities: Object.fromEntries(ABILITIES.map((k, i) => [k, +ab[i].value || 10])),
          saves: Object.fromEntries(ABILITIES.map((k, i) => [k, +sv[i].value | 0])),
          actions: parseActionText(actions.value),
        };
        next.hp = Math.min(next.hp, next.maxHp);
        if (isNew && !isDM()) next.player = store.me.name;
        // Inventory is edited live from the bag; don't overwrite it with this snapshot
        if (!isNew) delete next.inventory;
        dispatch({ type: 'party.upsertChar', char: next });
      },
    }],
  });
}
