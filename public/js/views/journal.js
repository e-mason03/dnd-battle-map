// ============================================================
// Journal — adventure log (sessions + auto events), full combat
// log, encounter history, and the NPC registry
// ============================================================

import { store, subscribe, dispatch, isDM } from '../store.js';
import { uid } from '../core/util.js';
import { parseActionText, actionsToText } from '../core/actions.js';
import { h, toast, openModal, confirmDialog, field, pickFile, fmtTime } from '../ui/dom.js';
import { uploadImage } from '../net.js';
import { fileUrl } from '../store.js';
import { logLine } from './battlePanels.js';

let root;
let sub = 'adventure';
const filters = { enc: '', kind: '', q: '' };

export function mountJournal(el) {
  root = el;
  subscribe(changed => {
    if (['*', 'adventure', 'log', 'encounters', 'npcs', 'stats'].some(k => changed.has(k))) render();
  });
}

export function showJournalTab(name) { sub = name; render(); }

function render() {
  if (!store.state || !root) return;
  const scroll = root.scrollTop;
  root.innerHTML = '';
  const tab = (k, l, n) => h('button', { class: 'pill' + (sub === k ? ' active' : ''), onclick: () => { sub = k; render(); } }, l, n != null ? h('span', { class: 'count' }, n) : null);
  root.append(h('div', { class: 'page-head' },
    h('h2', {}, 'Journal'),
    h('div', { class: 'pills' },
      tab('adventure', '📜 Adventure Log'),
      tab('combat', '⚔ Combat Log', store.state.log.length),
      tab('encounters', '🏆 Encounters', store.state.encounters.length),
      tab('npcs', '🎭 NPCs', Object.keys(store.state.npcs).length))));
  const body = h('div', { class: 'journal-body' });
  root.append(body);
  body.append(...{ adventure, combat: combatLog, encounters, npcs }[sub]().filter(Boolean));
  root.scrollTop = scroll;
}

// ------------------------------------------------------------
// Adventure log
// ------------------------------------------------------------

const ADV_ICON = { skull: '💀', swords: '⚔️', boot: '🥾', sun: '☀️', user: '🧝', star: '⭐', mask: '🎭' };

function adventure() {
  const entries = [...store.state.adventure].reverse();
  const sessions = store.state.adventure.filter(e => e.kind === 'session');
  const kind = h('select', {}, h('option', { value: 'session' }, 'Session recap'), h('option', { value: 'note' }, 'Note / journal entry'));
  const title = h('input', { type: 'text', placeholder: `Session ${sessions.length + 1}: …`, maxlength: 200 });
  const text = h('textarea', { rows: 4, placeholder: 'What happened? Who did you meet? What did you find?' });
  const composer = h('div', { class: 'composer card' },
    h('div', { class: 'row' }, kind, title),
    text,
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => {
      if (!title.value.trim() && !text.value.trim()) { title.focus(); return; }
      const isSession = kind.value === 'session';
      dispatch({ type: 'adventure.add', entry: {
        kind: kind.value, session: isSession ? sessions.length + 1 : undefined,
        title: title.value.trim() || (isSession ? `Session ${sessions.length + 1}` : 'Note'), text: text.value.trim(),
      } });
      title.value = ''; text.value = '';
    } }, 'Add to log')));

  const out = [composer];
  if (!entries.length) out.push(h('p', { class: 'empty-inline' }, 'Your story starts here. Travel, level-ups, fallen heroes and finished encounters are added automatically.'));
  const timeline = h('div', { class: 'timeline' });
  let lastDay = '';
  for (const e of entries) {
    const day = new Date(e.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (day !== lastDay) { timeline.append(h('div', { class: 'tl-date' }, day)); lastDay = day; }
    const canEditEntry = isDM() || e.by === store.me.name;
    if (e.kind === 'event') {
      timeline.append(h('div', { class: 'tl-event' }, h('span', { class: 'ic' }, ADV_ICON[e.icon] || '•'),
        h('div', { class: 'grow' }, h('b', {}, e.title), e.text ? h('span', { class: 'muted' }, ' — ' + e.text) : null),
        h('small', { class: 'muted' }, fmtTime(e.ts))));
    } else {
      timeline.append(h('div', { class: 'tl-entry card ' + e.kind },
        h('div', { class: 'tl-head' },
          h('span', { class: 'badge' }, e.kind === 'session' ? `Session ${e.session || ''}` : 'Note'),
          h('h3', {}, e.title),
          h('small', { class: 'muted grow' }, `${e.by || ''} · ${fmtTime(e.ts)}`),
          canEditEntry ? h('button', { class: 'icon-btn', title: 'Edit', onclick: () => editEntry(e) }, '✎') : null,
          canEditEntry ? h('button', { class: 'icon-btn', title: 'Delete', onclick: async () => { if (await confirmDialog('Delete this entry?', 'Delete', true)) dispatch({ type: 'adventure.remove', id: e.id }); } }, '🗑') : null),
        e.text ? h('div', { class: 'tl-text' }, e.text) : null));
    }
  }
  out.push(timeline);
  return out;
}

function editEntry(e) {
  const title = h('input', { type: 'text', value: e.title });
  const text = h('textarea', { rows: 10 }, e.text || '');
  openModal({
    title: 'Edit entry', wide: true,
    body: h('div', {}, field('Title', title), field('Text', text)),
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', onClick: () => dispatch({ type: 'adventure.update', id: e.id, patch: { title: title.value, text: text.value } }) }],
  });
}

// ------------------------------------------------------------
// Combat log
// ------------------------------------------------------------

function combatLog() {
  const encs = store.state.encounters;
  const encSel = h('select', { onchange: e => { filters.enc = e.target.value; render(); } },
    h('option', { value: '' }, 'All activity'), encs.map(e => h('option', { value: e.id, selected: filters.enc === e.id }, e.name)));
  const kindSel = h('select', { onchange: e => { filters.kind = e.target.value; render(); } },
    [['', 'All kinds'], ['attack', 'Attacks'], ['heal', 'Healing'], ['death', 'Deaths'], ['roll', 'Dice rolls'], ['combat', 'Rounds'], ['conc', 'Concentration'], ['note', 'Notes']]
      .map(([v, l]) => h('option', { value: v, selected: filters.kind === v }, l)));
  const q = h('input', { type: 'search', placeholder: 'Search…', value: filters.q });
  q.addEventListener('input', () => { filters.q = q.value; clearTimeout(q.t); q.t = setTimeout(render, 250); });

  const list = store.state.log.filter(e =>
    (!filters.enc || e.enc === filters.enc) && (!filters.kind || e.kind === filters.kind) &&
    (!filters.q || e.text.toLowerCase().includes(filters.q.toLowerCase()))).reverse();

  return [
    h('div', { class: 'row filters' }, encSel, kindSel, q),
    list.length ? h('div', { class: 'log-feed full card' }, list.map(logLine)) : h('p', { class: 'empty-inline' }, 'Nothing logged yet.'),
    h('p', { class: 'hint' }, `Showing ${list.length} of the last ${store.state.log.length} entries (the room keeps the most recent 600).`),
  ];
}

// ------------------------------------------------------------
// Encounters
// ------------------------------------------------------------

function encounters() {
  const encs = [...store.state.encounters].reverse();
  if (!encs.length) return [h('p', { class: 'empty-inline' }, 'Start combat on the Battle Map to record an encounter.')];
  return [h('div', { class: 'enc-grid' }, encs.map(e => {
    const dmg = Object.entries(e.damage || {}).sort((a, b) => b[1] - a[1]);
    const max = dmg[0]?.[1] || 1;
    const mins = e.end ? Math.max(1, Math.round((e.end - e.start) / 60000)) : null;
    return h('div', { class: 'card enc-card' + (e.end ? '' : ' live') },
      h('div', { class: 'tl-head' },
        h('h3', { class: 'grow' }, e.name),
        e.end ? null : h('span', { class: 'badge live' }, 'LIVE'),
        isDM() ? h('button', { class: 'icon-btn', title: 'Edit', onclick: () => editEncounter(e) }, '✎') : null,
        isDM() ? h('button', { class: 'icon-btn', title: 'Delete', onclick: async () => { if (await confirmDialog(`Delete "${e.name}"?`, 'Delete', true)) dispatch({ type: 'encounter.remove', id: e.id }); } }, '🗑') : null),
      h('div', { class: 'muted' }, new Date(e.start).toLocaleString(), ` · ${e.rounds} round${e.rounds === 1 ? '' : 's'}`, mins ? ` · ${mins} min` : ''),
      h('div', { class: 'chips' }, e.participants.map(p => h('span', { class: 'chip' + (p.pc ? ' pc' : '') }, p.name))),
      dmg.length ? h('div', { class: 'bars' }, h('div', { class: 'section-title' }, 'Damage dealt'),
        dmg.map(([name, v]) => h('div', { class: 'bar-row', title: `${name}: ${v} damage` },
          h('span', { class: 'bar-label' }, name),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: (v / max * 100) + '%' } })),
          h('b', {}, v)))) : null,
      e.kills?.length ? h('div', {}, h('div', { class: 'section-title' }, 'Defeated'), h('div', { class: 'muted' }, e.kills.map(k => `${k.target} (by ${k.by})`).join(' · '))) : null,
      e.notes ? h('p', { class: 'note' }, e.notes) : null);
  }))];
}

function editEncounter(e) {
  const name = h('input', { type: 'text', value: e.name });
  const notes = h('textarea', { rows: 5 }, e.notes || '');
  openModal({
    title: 'Edit encounter',
    body: h('div', {}, field('Name', name), field('DM notes (hidden from players)', notes)),
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', onClick: () => dispatch({ type: 'encounter.update', id: e.id, patch: { name: name.value.trim() || e.name, notes: notes.value } }) }],
  });
}

// ------------------------------------------------------------
// NPCs
// ------------------------------------------------------------

const ATTITUDES = { ally: '💚 Ally', friendly: '🙂 Friendly', neutral: '😐 Neutral', wary: '🤨 Wary', hostile: '😠 Hostile' };

function npcs() {
  const list = Object.values(store.state.npcs).sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  if (isDM()) out.push(h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => editNpc(null) }, '＋ New NPC')));
  if (!list.length) out.push(h('p', { class: 'empty-inline' }, isDM() ? 'Track the people the party meets. Hidden NPCs stay secret until you reveal them.' : 'The party has not met anyone notable yet.'));
  out.push(h('div', { class: 'npc-grid' }, list.map(n => h('div', { class: 'card npc-card' + (n.hidden ? ' hidden-npc' : '') + (n.dead ? ' dead' : '') },
    h('div', { class: 'cc-head' },
      h('div', { class: 'cc-avatar', style: { background: n.color || '#2e6b8a' } }, n.portraitId ? h('img', { src: fileUrl(n.portraitId), alt: '' }) : n.name.slice(0, 2).toUpperCase()),
      h('div', { class: 'grow' },
        h('div', { class: 'cc-name' }, n.name, n.dead ? ' ☠' : ''),
        h('div', { class: 'cc-sub' }, [n.role, n.location].filter(Boolean).join(' · ')),
        h('div', {}, h('span', { class: 'tag att-' + (n.attitude || 'neutral') }, ATTITUDES[n.attitude || 'neutral']), n.hidden ? h('span', { class: 'tag' }, 'hidden') : null))),
    n.notes ? h('p', { class: 'note' }, n.notes) : null,
    isDM() && n.dmNotes ? h('p', { class: 'note dm' }, '🔒 ', n.dmNotes) : null,
    isDM() ? h('div', { class: 'muted small' }, `AC ${n.ac || 10} · HP ${n.maxHp || 10}`, n.actions ? ` · ${parseActionText(n.actions).length} action(s)` : '') : null,
    isDM() ? h('div', { class: 'cc-foot' },
      h('button', { class: 'btn tiny', onclick: () => editNpc(n) }, '✎ Edit'),
      h('button', { class: 'btn tiny', onclick: () => dispatch({ type: 'npc.upsert', npc: { ...n, hidden: !n.hidden } }) }, n.hidden ? '👁 Reveal' : '🙈 Hide'),
      h('button', { class: 'btn tiny danger', onclick: async () => { if (await confirmDialog(`Delete ${n.name}?`, 'Delete', true)) dispatch({ type: 'npc.remove', id: n.id }); } }, '🗑')) : null))));
  return out;
}

function editNpc(n) {
  const isNew = !n;
  n = n || { id: 'npc-' + uid(8), name: '', attitude: 'neutral', ac: 10, maxHp: 10, speed: 30, hidden: false, color: '#2e6b8a', actions: 'Club | melee | 2 | 1d4 bludgeoning | 5' };
  const inp = (v, type = 'text', attrs = {}) => h('input', { type, value: v ?? '', ...attrs });
  const f = {
    name: inp(n.name), role: inp(n.role, 'text', { placeholder: 'Innkeeper, cult leader…' }), location: inp(n.location, 'text', { placeholder: 'Phandalin' }),
    attitude: h('select', {}, Object.entries(ATTITUDES).map(([k, l]) => h('option', { value: k, selected: n.attitude === k }, l))),
    notes: h('textarea', { rows: 3 }, n.notes || ''), dmNotes: h('textarea', { rows: 3 }, n.dmNotes || ''),
    ac: inp(n.ac, 'number'), maxHp: inp(n.maxHp, 'number'), speed: inp(n.speed, 'number', { step: 5 }), initBonus: inp(n.initBonus || 0, 'number'),
    color: inp(n.color, 'color'), hidden: h('input', { type: 'checkbox', checked: !!n.hidden }), dead: h('input', { type: 'checkbox', checked: !!n.dead }),
    actions: h('textarea', { rows: 4, spellcheck: false }, typeof n.actions === 'string' ? n.actions : actionsToText(n.actions)),
  };
  let portraitId = n.portraitId || null;
  const portraitBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try { portraitId = (await uploadImage(file)).fileId; portraitBtn.textContent = '✔ Portrait uploaded'; } catch (e) { toast(e.message, true); }
  } }, portraitId ? 'Replace portrait' : '📁 Upload portrait');

  openModal({
    title: isNew ? 'New NPC' : `Edit ${n.name}`, wide: true,
    body: h('div', { class: 'form-grid' },
      field('Name', f.name), field('Attitude', f.attitude), field('Role', f.role), field('Location', f.location),
      h('div', { class: 'span2' }, field('Notes (players can see)', f.notes)),
      h('div', { class: 'span2' }, field('DM secrets', f.dmNotes)),
      field('AC', f.ac), field('Max HP', f.maxHp), field('Speed', f.speed), field('Initiative bonus', f.initBonus),
      h('div', { class: 'span2' }, field('Actions (for battle)', f.actions, 'Name | melee/ranged/spell/save:dex/heal/auto | to-hit or DC | damage type | range ft | area (20, 15 cone, 60 line, 10 cube) | flags')),
      field('Token color', f.color), field('Portrait', portraitBtn),
      h('label', { class: 'check' }, f.hidden, 'Hidden from players'), h('label', { class: 'check' }, f.dead, 'Deceased')),
    actions: [{ label: 'Cancel' }, {
      label: 'Save', class: 'primary', onClick: () => {
        if (!f.name.value.trim()) { toast('Give the NPC a name', true); return false; }
        dispatch({ type: 'npc.upsert', npc: {
          ...n, name: f.name.value.trim(), role: f.role.value.trim(), location: f.location.value.trim(), attitude: f.attitude.value,
          notes: f.notes.value.trim(), dmNotes: f.dmNotes.value.trim(), ac: +f.ac.value | 0, maxHp: Math.max(1, +f.maxHp.value | 0),
          speed: +f.speed.value | 0, initBonus: +f.initBonus.value | 0, color: f.color.value, hidden: f.hidden.checked, dead: f.dead.checked,
          actions: f.actions.value, portraitId,
        } });
      },
    }],
  });
}

