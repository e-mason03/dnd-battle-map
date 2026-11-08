// ============================================================
// DOM helpers: element builder, toasts, modals
// ============================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div', { class: 'x', onclick: fn }, child, 'text', [more])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function toast(msg, isError = false) {
  const t = h('div', { class: 'toast' + (isError ? ' error' : '') }, msg);
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// Returns { close, root }. actions: [{ label, class, onClick(close) → false keeps open }]
export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const overlay = h('div', { class: 'modal-overlay open' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  // Escape closes only the topmost modal when several are stacked
  const onKey = e => { if (e.key === 'Escape' && [...document.querySelectorAll('.modal-overlay')].pop() === overlay) close(); };
  document.addEventListener('keydown', onKey);
  const modal = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', title: 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-btns' }, actions.map(a =>
      h('button', { class: 'btn ' + (a.class || ''), onclick: async () => { if ((await a.onClick?.(close)) !== false) close(); } }, a.label),
    )) : null,
  );
  overlay.appendChild(modal);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  modal.querySelector('input, textarea, select')?.focus();
  return { close, root: modal };
}

export function confirmDialog(text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let ok = false;
    openModal({
      title: 'Are you sure?',
      body: h('p', {}, text),
      actions: [
        { label: 'Cancel' },
        { label: okLabel, class: danger ? 'danger' : 'primary', onClick: () => { ok = true; } },
      ],
      onClose: () => resolve(ok),
    });
  });
}

export function promptDialog(title, label, value = '') {
  return new Promise(resolve => {
    let result = null;
    const input = h('input', { type: 'text', value });
    const m = openModal({
      title,
      body: h('label', { class: 'field' }, h('span', {}, label), input),
      actions: [{ label: 'Cancel' }, { label: 'OK', class: 'primary', onClick: () => { result = input.value; } }],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { result = input.value; m.close(); } });
  });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
