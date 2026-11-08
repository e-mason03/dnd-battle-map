// ============================================================
// Party inventory — a bag modal with each character's armor,
// weapons and consumables, plus the shared party stash
// ============================================================

import { store, subscribe, dispatch, isDM } from '../store.js';
import { ITEM_CATS } from '../core/ops.js';
import { uid } from '../core/util.js';
import { h, openModal, confirmDialog, promptDialog, field } from '../ui/dom.js';

const CAT_LABEL = { armor: 'Armor', weapon: 'Weapons', consumable: 'Consumables', gear: 'Other gear', quest: 'Quest items', treasure: 'Treasure', misc: 'Miscellaneous' };
const CAT_ICON = { armor: '🛡', weapon: '⚔', consumable: '🧪', gear: '🎒', quest: '📜', treasure: '💎', misc: '📦' };
// Groups always shown (even when empty) for each kind of section
const CHAR_GROUPS = ['armor', 'weapon', 'consumable'];
const PARTY_GROUPS = ['quest', 'treasure', 'misc'];
const RARITY_CLASS = { uncommon: 'r-uncommon', rare: 'r-rare', 'very rare': 'r-vrare', legendary: 'r-legendary', artifact: 'r-artifact' };

const canEditBag = owner => owner === 'party' || isDM() || store.state.party.chars[owner]?.player === store.me?.name;
const bagItems = owner => (owner === 'party' ? store.state.party.items : store.state.party.chars[owner]?.inventory) || [];
const ownerName = owner => owner === 'party' ? 'the party stash' : store.state.party.chars[owner]?.name || 'someone';

// Characters whose sections are collapsed — kept across re-renders and reopenings
const collapsed = new Set();
let rerender = null;

export function openInventory(focusId) {
  const body = h('div', { class: 'inv' });
  let unsub;

  const render = () => {
    const chars = Object.values(store.state.party.chars).sort((a, b) => a.name.localeCompare(b.name));
    body.replaceChildren(...[
      chars.length ? null : h('p', { class: 'empty-inline' }, 'No adventurers yet — the party stash is still open.'),
      ...chars.map(charSection),
      partySection(),
    ].filter(Boolean));
  };

  openModal({ title: '🎒 Party Inventory', body, wide: true, onClose: () => { unsub?.(); rerender = null; } });
  unsub = subscribe(changed => { if (changed.has('*') || changed.has('party')) render(); });
  rerender = render;
  if (focusId) collapsed.delete(focusId);
  render();
  if (focusId) body.querySelector(`[data-owner="${focusId}"]`)?.scrollIntoView({ block: 'start' });
}

function charSection(ch) {
  const items = ch.inventory || [];
  const open = !collapsed.has(ch.id);
  const extra = ITEM_CATS.filter(c => !CHAR_GROUPS.includes(c) && items.some(i => i.cat === c));
  return h('div', { class: 'inv-sec' + (open ? '' : ' closed'), 'data-owner': ch.id, style: { borderLeftColor: ch.color || '#2e6b8a' } },
    h('div', { class: 'inv-head', onclick: () => { open ? collapsed.add(ch.id) : collapsed.delete(ch.id); rerender?.(); } },
      h('span', { class: 'inv-caret' }, open ? '▾' : '▸'),
      h('span', { class: 'inv-dot', style: { background: ch.color } }),
      h('b', { class: 'inv-name' }, ch.name),
      ch.player ? h('span', { class: 'tag' }, ch.player) : null,
      h('span', { class: 'grow' }),
      h('span', { class: 'muted' }, countLabel(items)),
      h('span', { class: 'inv-gold', title: 'Gold (from the character sheet)' }, `${ch.gold || 0} gp`),
      canEditBag(ch.id) ? h('button', { class: 'btn tiny', onclick: e => { e.stopPropagation(); openItemEditor(ch.id, { cat: 'gear' }); } }, '＋ Add') : null),
    open ? h('div', { class: 'inv-groups' }, [...CHAR_GROUPS, ...extra].map(cat => group(ch.id, cat, items))) : null);
}

function partySection() {
  const items = store.state.party.items || [];
  const extra = ITEM_CATS.filter(c => !PARTY_GROUPS.includes(c) && items.some(i => i.cat === c));
  return h('div', { class: 'inv-sec party', 'data-owner': 'party' },
    h('div', { class: 'inv-head' },
      h('span', { class: 'inv-name-icon' }, '⚜'),
      h('b', { class: 'inv-name' }, 'Party Items'),
      h('span', { class: 'grow' }),
      h('span', { class: 'muted' }, countLabel(items)),
      h('button', { class: 'btn tiny', onclick: () => openItemEditor('party', { cat: 'misc' }) }, '＋ Add')),
    h('div', { class: 'inv-groups' }, [...PARTY_GROUPS, ...extra].map(cat => group('party', cat, items))));
}

function countLabel(items) {
  const n = items.reduce((s, i) => s + i.qty, 0);
  return `${n} item${n === 1 ? '' : 's'}`;
}

function group(owner, cat, items) {
  const list = items.filter(i => i.cat === cat).sort((a, b) => (b.equipped - a.equipped) || a.name.localeCompare(b.name));
  return h('div', { class: 'inv-group' },
    h('div', { class: 'inv-cat' }, CAT_ICON[cat], ' ', CAT_LABEL[cat]),
    list.length ? list.map(it => itemRow(owner, it)) : h('div', { class: 'inv-none' }, 'None'));
}

function itemRow(owner, it) {
  const edit = canEditBag(owner);
  const wearable = owner !== 'party' && ['armor', 'weapon', 'gear'].includes(it.cat);
  return h('div', { class: 'inv-item' + (it.equipped ? ' equipped' : '') },
    h('div', { class: 'grow' },
      h('span', { class: 'inv-iname ' + (RARITY_CLASS[String(it.notes || '').toLowerCase()] || '') }, it.name),
      it.qty > 1 ? h('span', { class: 'inv-qty' }, '×' + it.qty) : null,
      it.equipped ? h('span', { class: 'tag' }, it.cat === 'weapon' ? 'wielded' : 'equipped') : null,
      it.attuned ? h('span', { class: 'tag' }, 'attuned') : null,
      it.notes ? h('div', { class: 'inv-notes' }, it.notes) : null),
    edit ? h('div', { class: 'inv-ctl' },
      it.cat === 'consumable' || it.qty > 1 ? h('button', { class: 'btn tiny', title: it.qty > 1 ? 'Use one' : 'Use up', onclick: () => useOne(owner, it) }, '−') : null,
      it.cat === 'consumable' ? h('button', { class: 'btn tiny', title: 'Add one', onclick: () => dispatch({ type: 'party.item', owner, item: { ...it, qty: it.qty + 1 } }) }, '+') : null,
      wearable ? h('button', { class: 'btn tiny', title: it.equipped ? 'Unequip' : 'Equip', onclick: () => dispatch({ type: 'party.item', owner, item: { ...it, equipped: !it.equipped } }) }, it.equipped ? 'Unequip' : 'Equip') : null,
      giveSelect(owner, it),
      h('button', { class: 'btn tiny', title: 'Edit', onclick: () => openItemEditor(owner, it) }, '✎'),
      h('button', { class: 'btn tiny danger', title: 'Discard', onclick: async () => {
        if (await confirmDialog(`Discard ${it.name}${it.qty > 1 ? ` (×${it.qty})` : ''}?`, 'Discard', true)) dispatch({ type: 'party.itemRemove', owner, itemId: it.id });
      } }, '🗑')) : null);
}

function useOne(owner, it) {
  if (it.qty > 1) dispatch({ type: 'party.item', owner, item: { ...it, qty: it.qty - 1 } });
  else dispatch({ type: 'party.itemRemove', owner, itemId: it.id });
}

function giveSelect(owner, it) {
  const dests = [
    owner !== 'party' ? ['party', '⚜ Party stash'] : null,
    ...Object.values(store.state.party.chars).filter(c => c.id !== owner).map(c => [c.id, c.name]),
  ].filter(Boolean);
  if (!dests.length) return null;
  return h('select', { class: 'inv-give', title: owner === 'party' ? 'Hand to a character' : 'Give or stash', onchange: async e => {
    const to = e.target.value;
    e.target.value = '';
    if (!to) return;
    let qty = it.qty;
    if (it.qty > 1) {
      const val = await promptDialog(`Move ${it.name}`, `How many to ${ownerName(to)}? (of ${it.qty})`, String(it.qty));
      if (val === null) return;
      qty = Math.max(1, Math.min(it.qty, parseInt(val, 10) || 0));
    }
    dispatch({ type: 'party.itemMove', from: owner, to, itemId: it.id, qty });
  } }, h('option', { value: '' }, owner === 'party' ? 'Give…' : 'Move…'), dests.map(([v, label]) => h('option', { value: v }, label)));
}

function openItemEditor(owner, it) {
  const isNew = !it.id;
  const name = h('input', { type: 'text', value: it.name || '', placeholder: 'Potion of Healing' });
  const cat = h('select', {}, ITEM_CATS.map(c => h('option', { value: c, selected: c === it.cat }, `${CAT_ICON[c]} ${CAT_LABEL[c]}`)));
  const qty = h('input', { type: 'number', min: 1, value: it.qty || 1 });
  const notes = h('textarea', { rows: 3, placeholder: 'Rarity, charges, who gave it to you, what it unlocks…' }, it.notes || '');
  const equipped = h('input', { type: 'checkbox', checked: !!it.equipped });
  const attuned = h('input', { type: 'checkbox', checked: !!it.attuned });

  const save = () => {
    if (!name.value.trim()) { name.focus(); return false; }
    dispatch({ type: 'party.item', owner, item: {
      ...it, id: it.id || 'it-' + uid(8), name: name.value.trim(), cat: cat.value,
      qty: Math.max(1, parseInt(qty.value, 10) || 1), notes: notes.value.trim(),
      equipped: owner !== 'party' && equipped.checked, attuned: owner !== 'party' && attuned.checked,
    } });
  };

  const m = openModal({
    title: `${isNew ? 'Add item to' : 'Edit item in'} ${owner === 'party' ? 'Party Items' : ownerName(owner) + "'s pack"}`,
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'span2' }, field('Name', name)),
      field('Category', cat), field('Quantity', qty),
      owner !== 'party' ? h('label', { class: 'check' }, equipped, 'Equipped / wielded') : null,
      owner !== 'party' ? h('label', { class: 'check' }, attuned, 'Attuned') : null,
      h('div', { class: 'span2' }, field('Notes', notes))),
    actions: [{ label: 'Cancel' }, { label: isNew ? 'Add' : 'Save', class: 'primary', onClick: save }],
  });
  name.addEventListener('keydown', e => { if (e.key === 'Enter' && save() !== false) m.close(); });
}
