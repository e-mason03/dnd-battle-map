// ============================================================
// Dice tray — shared rolls everyone sees (and that feed the
// dice-luck stats); the DM can also roll privately
// ============================================================

import { store, onOp, dispatch, isDM } from '../store.js';
import { roll, parseDice } from '../core/dice.js';
import { h, $ } from './dom.js';

let pool = {};     // sides → count
let mod = 0;
let panel;

export function mountDice() {
  panel = h('div', { class: 'dice-panel' });
  const btn = h('button', { class: 'dice-fab', title: 'Dice tray', onclick: () => { panel.classList.toggle('open'); renderPanel(); } }, '🎲');
  document.body.append(panel, btn, h('div', { class: 'dice-pops', id: 'dicePops' }));
  onOp(op => { if (op.type === 'dice.roll') showRoll(op.by, op.notation, op.rolls, op.total, op.label); });
}

function notation() {
  const parts = Object.entries(pool).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]).map(([s, n]) => `${n}d${s}`);
  let s = parts.join('+');
  if (mod) s += (mod > 0 ? '+' : '') + mod;
  return s || '1d20';
}

function renderPanel() {
  panel.innerHTML = '';
  const input = h('input', { type: 'text', value: notation(), class: 'dice-notation', spellcheck: false });
  const label = h('input', { type: 'text', placeholder: 'What for? (optional)', maxlength: 60 });
  const doRoll = secret => {
    const n = input.value.trim() || '1d20';
    if (!parseDice(n).dice.length) { input.focus(); return; }
    const r = roll(n);
    const rolls = r.rolls.map(x => ({ sides: x.sides, value: x.value }));
    if (secret) showRoll(store.me.name + ' (secret)', n, rolls, r.total, label.value.trim());
    else dispatch({ type: 'dice.roll', notation: n, rolls, total: r.total, label: label.value.trim() });
    pool = {}; mod = 0;
    renderPanel();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doRoll(false); });

  panel.append(
    h('div', { class: 'dice-grid' }, [4, 6, 8, 10, 12, 20, 100].map(s => h('button', {
      class: 'die-btn d' + s,
      title: 'Left-click add · right-click remove',
      onclick: () => { pool[s] = (pool[s] || 0) + 1; renderPanel(); },
      oncontextmenu: e => { e.preventDefault(); pool[s] = Math.max(0, (pool[s] || 0) - 1); renderPanel(); },
    }, h('b', {}, 'd' + s), pool[s] ? h('span', { class: 'count' }, pool[s]) : null))),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { mod--; renderPanel(); } }, '−'),
      h('span', { class: 'mod' }, (mod >= 0 ? '+' : '') + mod),
      h('button', { class: 'btn small', onclick: () => { mod++; renderPanel(); } }, '+'),
      h('button', { class: 'btn small', onclick: () => { pool = {}; mod = 0; renderPanel(); } }, 'Clear')),
    input, label,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', onclick: () => doRoll(false) }, 'Roll for everyone'),
      isDM() ? h('button', { class: 'btn', title: 'Only you see this roll', onclick: () => doRoll(true) }, '🙈 Secret') : null),
    h('div', { class: 'row quick' }, ['1d20', '1d20+5', '2d6', '4d6', '8d6'].map(q =>
      h('button', { class: 'chip', onclick: () => { input.value = q; } }, q))),
  );
}

function showRoll(by, n, rolls, total, label) {
  const box = $('#dicePops');
  if (!box) return;
  const d20 = rolls.length === 1 && rolls[0].sides === 20 ? rolls[0].value : null;
  const totalEl = h('b', { class: 'total rolling' }, '?');
  const card = h('div', { class: 'dice-pop' + (d20 === 20 ? ' crit' : d20 === 1 ? ' fumble' : '') },
    h('div', { class: 'who' }, by, label ? h('span', { class: 'muted' }, ` · ${label}`) : null),
    h('div', { class: 'dice-row' }, rolls.slice(0, 12).map(r => h('span', { class: 'die d' + r.sides + (r.value === r.sides ? ' max' : r.value === 1 ? ' min' : '') }, r.value)), rolls.length > 12 ? '…' : null),
    h('div', { class: 'result' }, h('small', {}, n), totalEl));
  box.prepend(card);
  let ticks = 0;
  const maxGuess = Math.max(2, rolls.reduce((s, r) => s + r.sides, 0));
  const iv = setInterval(() => {
    totalEl.textContent = 1 + Math.floor(Math.random() * maxGuess);
    if (++ticks > 10) { clearInterval(iv); totalEl.textContent = total; totalEl.classList.remove('rolling'); }
  }, 50);
  setTimeout(() => card.classList.add('out'), 5200);
  setTimeout(() => card.remove(), 5600);
  while (box.children.length > 4) box.lastChild.remove();
}
