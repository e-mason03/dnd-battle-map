// ============================================================
// Client store — the local copy of campaign state plus a tiny
// pub/sub so views re-render when something changes
// ============================================================

import { applyOp, ownsToken } from './core/ops.js';
import { uid } from './core/util.js';

export const store = {
  state: null,
  me: null,           // { name, role }
  session: null,      // { code, token, name, role, roomName }
  users: [],
  connected: false,
};

const listeners = new Set();
const opListeners = new Set();

// fn(changedSections: Set<string>)
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
// fn(op, { local }) — for effects/animations that should fire once per op
export function onOp(fn) { opListeners.add(fn); return () => opListeners.delete(fn); }

export function emit(sections) {
  const set = sections instanceof Set ? sections : new Set(sections);
  for (const fn of listeners) {
    try { fn(set); } catch (e) { console.error(e); }
  }
}

export function receiveOp(op, local) {
  let touched;
  try {
    touched = applyOp(store.state, op);
  } catch (e) {
    console.warn('Could not apply op', op.type, e);
    return;
  }
  for (const fn of opListeners) {
    try { fn(op, { local }); } catch (e) { console.error(e); }
  }
  emit(touched);
}

let sender = null;
export function setSender(fn) { sender = fn; }

// Apply locally (optimistic) and send to the room. With optimistic: false
// the op is only sent and its result arrives from the room instead.
export function dispatch(op, { optimistic = true } = {}) {
  op.id ||= uid(8);
  op.ts ||= Date.now();
  op.by = store.me?.name;
  if (optimistic) receiveOp(op, true);
  sender?.(op);
}

// Room → player: authoritative results of an op the player can't compute
export function receivePatch(p) {
  const s = store.state;
  Object.assign(s.battle.tokens, p.tokens || {});
  Object.assign(s.party.chars, p.chars || {});
  if (p.combat) s.battle.combat = p.combat;
  if (p.stats) s.stats = p.stats;
  if (p.encounters) s.encounters = p.encounters;
  for (const [key, entries] of [['log', p.log], ['adventure', p.adventure]]) {
    for (const e of entries || []) {
      const i = s[key].findIndex(x => x.id === e.id);
      if (i >= 0) s[key][i] = e; else s[key].push(e);
    }
  }
  emit(['battle', 'party', 'stats', 'encounters', 'log', 'adventure']);
}

export const isDM = () => store.me?.role === 'dm';
export const canEdit = () => isDM() || !!store.state?.meta.settings.playersCanEdit;
export const myToken = tok => !!tok && !!store.me && ownsToken(store.state, store.me, tok);

export function fileUrl(id) {
  if (!id || !store.session) return '';
  return `/api/rooms/${store.session.code}/files/${id}?t=${encodeURIComponent(store.session.token)}`;
}

// Avatar source for a creature view: external URL (DDB) or an uploaded room file
export const avatarOf = v => v?.avatar || (v?.avatarFile ? fileUrl(v.avatarFile) : null);
