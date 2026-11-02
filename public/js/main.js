// ============================================================
// App shell — room gate, top navigation, view switching
// ============================================================

import { store, subscribe, dispatch, isDM } from './store.js';
import { createRoom, joinRoom, checkSession, savedSession, forgetSession, connect, resync } from './net.js';
import { h, $, $$, toast, openModal, field } from './ui/dom.js';
import { mountDice } from './ui/dice.js';
import { mountBattle, showBattle } from './views/battle.js';
import { mountHex, showHex } from './views/hex.js';
import { mountParty } from './views/party.js';
import { mountJournal } from './views/journal.js';
import { mountStats } from './views/stats.js';

const VIEWS = ['battle', 'hex', 'party', 'journal', 'stats'];
let current = 'battle';

// ------------------------------------------------------------
// Gate
// ------------------------------------------------------------

function initGate() {
  const params = new URLSearchParams(location.search);
  const code = params.get('room');
  if (code) $('#joinCode').value = code.toUpperCase();

  $$('.gate-tab').forEach(b => b.addEventListener('click', () => {
    $$('.gate-tab').forEach(x => x.classList.toggle('active', x === b));
    $$('.gate-form').forEach(f => f.classList.toggle('active', f.id === b.dataset.form));
  }));

  $('#joinForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submit(e.target, () => joinRoom({ code: $('#joinCode').value, name: $('#joinName').value, password: $('#joinPassword').value }));
  });
  $('#createForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submit(e.target, () => createRoom({
      name: $('#createName').value, roomName: $('#createRoomName').value,
      dmPassword: $('#createDmPassword').value, playerPassword: $('#createPlayerPassword').value,
    }));
  });

  const prev = savedSession();
  if (prev) {
    $('#resume').hidden = false;
    $('#resumeText').textContent = `${prev.roomName || 'Room'} (${prev.code}) as ${prev.name}`;
    $('#resumeBtn').addEventListener('click', async () => {
      const s = await checkSession(prev);
      if (s) enter(s);
      else { forgetSession(); $('#resume').hidden = true; showGateError('That session expired — please join again.'); }
    });
    if (!code || code.toUpperCase() === prev.code) $('#resumeBtn').click();
  }
}

async function submit(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  showGateError('');
  try {
    enter(await fn());
  } catch (err) {
    showGateError(err.message);
  } finally {
    btn.disabled = false;
  }
}

function showGateError(msg) {
  const el = $('#gateError');
  el.textContent = msg;
  el.hidden = !msg;
}

function enter(session) {
  store.session = session;
  $('#gate').hidden = true;
  $('#app').hidden = false;
  history.replaceState(null, '', `?room=${session.code}`);
  connect(() => toast(`Welcome, ${store.me.name}!`));
  showView(location.hash.slice(1) || 'battle');
}

// ------------------------------------------------------------
// Shell
// ------------------------------------------------------------

function showView(name) {
  if (!VIEWS.includes(name)) name = 'battle';
  current = name;
  for (const v of VIEWS) $('#view-' + v).hidden = v !== name;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  showBattle(name === 'battle');
  showHex(name === 'hex');
  document.body.dataset.view = name;
  if (location.hash !== '#' + name) history.replaceState(null, '', location.search + '#' + name);
}

function renderTopbar() {
  if (!store.state) return;
  $('#campaignName').textContent = store.state.meta.name;
  document.title = `${store.state.meta.name} · D&D Table`;
  $('#roomCode').textContent = store.session.code;
  $('#roleBadge').textContent = isDM() ? 'DM' : 'Player';
  $('#roleBadge').className = 'role-badge ' + (isDM() ? 'dm' : 'player');
  $('#connDot').className = 'conn-dot' + (store.connected ? ' on' : '');
  $('#connDot').title = store.connected ? 'Connected' : 'Reconnecting…';
  const users = $('#presence');
  users.innerHTML = '';
  const seen = new Set();
  for (const u of store.users) {
    if (seen.has(u.name)) continue;
    seen.add(u.name);
    users.append(h('span', { class: 'avatar' + (u.role === 'dm' ? ' dm' : ''), title: `${u.name}${u.role === 'dm' ? ' (DM)' : ''}` }, u.name.slice(0, 2).toUpperCase()));
  }
}

function openSettings() {
  const s = store.state;
  const link = `${location.origin}/?room=${store.session.code}`;
  const name = h('input', { type: 'text', value: s.meta.name, disabled: !isDM() });
  const editable = h('input', { type: 'checkbox', checked: !!s.meta.settings.playersCanEdit, disabled: !isDM() });
  openModal({
    title: 'Room',
    body: h('div', {},
      field('Invite link', h('div', { class: 'row' }, h('input', { type: 'text', value: link, readonly: true }),
        h('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(link).then(() => toast('Link copied')) }, 'Copy')),
        'Players still need the player password.'),
      field('Campaign name', name),
      h('label', { class: 'check' }, editable, 'Let players paint maps and place monsters'),
      h('div', { class: 'section-title' }, 'Shortcuts'),
      h('ul', { class: 'shortcuts' },
        h('li', {}, h('kbd', {}, '1–9'), ' use hotbar action'), h('li', {}, h('kbd', {}, 'E'), ' end turn'),
        h('li', {}, h('kbd', {}, 'Esc'), ' cancel / deselect'), h('li', {}, h('kbd', {}, 'Space'), '+drag or right-drag to pan'),
        h('li', {}, h('kbd', {}, 'Alt'), '+click to ping the map'), h('li', {}, 'Double-click a token to edit it'))),
    actions: [
      { label: 'Resync', onClick: () => { resync(); toast('Resynced'); } },
      { label: 'Leave room', class: 'danger', onClick: () => { forgetSession(); location.href = location.pathname; } },
      isDM() ? { label: 'Save', class: 'primary', onClick: () => dispatch({ type: 'room.settings', patch: { name: name.value.trim() || 'Campaign', settings: { playersCanEdit: editable.checked } } }) } : { label: 'Close' },
    ],
  });
}

function initShell() {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#roomCode').addEventListener('click', () => {
    navigator.clipboard?.writeText(`${location.origin}/?room=${store.session.code}`).then(() => toast('Invite link copied'));
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));

  mountBattle($('#view-battle'));
  mountHex($('#view-hex'));
  mountParty($('#view-party'));
  mountJournal($('#view-journal'));
  mountStats($('#view-stats'));
  mountDice();

  subscribe(changed => {
    if (changed.has('*') || changed.has('meta') || changed.has('presence') || changed.has('connection')) renderTopbar();
  });
}

initShell();
initGate();
