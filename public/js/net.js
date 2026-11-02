// ============================================================
// Room API (create/join/upload) + WebSocket connection
// ============================================================

import { store, emit, receiveOp, receivePatch, setSender } from './store.js';
import { toast } from './ui/dom.js';

const SESSION_KEY = 'dnd-room-session';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(store.session ? { 'x-room-token': store.session.token } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function savedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}
export function forgetSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

export async function createRoom({ name, roomName, dmPassword, playerPassword }) {
  const s = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name, roomName, dmPassword, playerPassword }) });
  saveSession(s);
  return s;
}

export async function joinRoom({ code, name, password }) {
  const s = await api(`/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, {
    method: 'POST', body: JSON.stringify({ name, password }),
  });
  saveSession(s);
  return s;
}

export async function checkSession(s) {
  store.session = s;
  try {
    const me = await api(`/api/rooms/${s.code}/me`);
    return { ...s, ...me };
  } catch {
    store.session = null;
    return null;
  }
}

export async function fetchDdb(charId) {
  return api(`/api/rooms/${store.session.code}/ddb/${charId}`);
}

// Downscale big images in the browser so uploads stay small
async function shrinkImage(file, maxDim = 4096) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 4 * 1024 * 1024) return { blob: file, w: bmp.width, h: bmp.height };
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  return { blob, w: c.width, h: c.height };
}

export async function uploadImage(file) {
  const { blob, w, h } = await shrinkImage(file);
  const res = await fetch(`/api/rooms/${store.session.code}/files`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'image/jpeg', 'x-room-token': store.session.token },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return { fileId: data.id, w, h };
}

// ------------------------------------------------------------
// WebSocket
// ------------------------------------------------------------

let socket = null;
let seq = 0;
let retry = 0;
let pingTimer = null;
const outbox = [];

function send(op) {
  const msg = JSON.stringify({ type: 'op', seq: ++seq, op });
  if (socket?.readyState === WebSocket.OPEN) socket.send(msg);
  else outbox.push(msg);
}

export function sendRaw(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function resync() { sendRaw({ type: 'resync' }); }

// Ask the room whether attack rolls hit (players can't see monster AC)
const checks = new Map();
let checkSeq = 0;
export function checkAttacks(actorId, rolls) {
  return new Promise((resolve, reject) => {
    const reqId = ++checkSeq;
    checks.set(reqId, { resolve, reject });
    sendRaw({ type: 'check', reqId, actorId, rolls });
    setTimeout(() => { if (checks.delete(reqId)) reject(new Error('The room did not answer — check your connection')); }, 8000);
  });
}

let fxHandler = null;
export function onFx(fn) { fxHandler = fn; }

export function connect(onFirstSync) {
  setSender(send);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const { code, token } = store.session;
  socket = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?t=${encodeURIComponent(token)}`);
  let first = true;

  socket.onopen = () => {
    retry = 0;
    store.connected = true;
    while (outbox.length) socket.send(outbox.shift());
    clearInterval(pingTimer);
    pingTimer = setInterval(() => sendRaw({ type: 'ping' }), 25000);
    emit(['connection']);
  };

  socket.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'sync':
        store.state = msg.state;
        store.me = msg.me;
        emit(['*']);
        if (first) { first = false; onFirstSync?.(); }
        break;
      case 'section':
        if (store.state) { store.state[msg.key] = msg.value; emit([msg.key]); }
        break;
      case 'op':
        if (store.state) receiveOp(msg.op, false);
        break;
      case 'patch':
        if (store.state) receivePatch(msg);
        break;
      case 'presence':
        store.users = msg.users;
        emit(['presence']);
        break;
      case 'reject':
        toast(msg.reason || 'Action rejected', true);
        break;
      case 'checkResult': {
        const c = checks.get(msg.reqId);
        checks.delete(msg.reqId);
        if (c) (msg.error ? c.reject(new Error(msg.error)) : c.resolve(msg.results));
        break;
      }
      case 'fx':
        fxHandler?.(msg.fx, msg.by);
        break;
    }
  };

  socket.onclose = ev => {
    store.connected = false;
    clearInterval(pingTimer);
    emit(['connection']);
    if (ev.code === 1008 || ev.code === 4001) return;
    const delay = Math.min(10000, 500 * 2 ** retry++);
    setTimeout(() => connect(), delay);
  };
}
