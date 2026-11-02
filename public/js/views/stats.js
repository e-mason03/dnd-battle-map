// ============================================================
// Stats — hero numbers, party leaderboards, awards, dice luck
// ============================================================

import { store, subscribe } from '../store.js';
import { h } from '../ui/dom.js';

let root;

export function mountStats(el) {
  root = el;
  subscribe(changed => {
    if (['*', 'stats', 'adventure', 'party', 'encounters'].some(k => changed.has(k))) render();
  });
}

function render() {
  if (!store.state || !root) return;
  const s = store.state;
  const p = s.stats.party;
  const actors = Object.values(s.stats.actors);
  const pcs = actors.filter(a => a.isPC);
  const foes = actors.filter(a => !a.isPC);
  const sessions = s.adventure.filter(e => e.kind === 'session').length;
  const dice = Object.entries(s.stats.dice);
  const totalDice = dice.reduce((n, [, d]) => n + d.dice, 0);
  const miles = (p.hexes || 0) * (s.hex.milesPerHex || 6);

  root.innerHTML = '';
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Adventure Stats'), h('p', { class: 'muted' }, s.meta.name))));

  root.append(h('div', { class: 'stat-tiles' },
    tile('Sessions', sessions), tile('Encounters', p.encounters), tile('Rounds fought', p.rounds),
    tile('Foes slain', p.kills), tile('Times downed', p.downs), tile('Miles traveled', miles, `${p.hexes || 0} hexes`),
    tile('Days on the road', p.days), tile('Dice rolled', totalDice)));

  if (!pcs.length && !dice.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'big-icon' }, '📊'), h('h3', {}, 'No numbers yet'),
      h('p', {}, 'Fight something on the Battle Map, roll some dice, travel the hexcrawl — the stats fill themselves in.')));
    return;
  }

  const awards = computeAwards(pcs, dice, foes);
  if (awards.length) {
    root.append(h('h3', { class: 'sub-head' }, '🏅 Awards'),
      h('div', { class: 'award-grid' }, awards.map(a => h('div', { class: 'card award' },
        h('div', { class: 'award-icon' }, a.icon), h('div', {}, h('small', {}, a.title), h('b', {}, a.name), h('div', { class: 'muted' }, a.detail))))));
  }

  if (pcs.length) {
    root.append(h('h3', { class: 'sub-head' }, '⚔ Leaderboards'),
      h('div', { class: 'board-grid' },
        board('Damage dealt', pcs, a => a.dmgDealt),
        board('Healing done', pcs, a => a.healing),
        board('Kills', pcs, a => a.kills),
        board('Damage taken', pcs, a => a.dmgTaken),
        board('Hit rate', pcs.filter(a => a.attacks >= 3), a => Math.round(a.hits / a.attacks * 100), '%'),
        board('Critical hits', pcs, a => a.crits)));

    root.append(h('h3', { class: 'sub-head' }, '📋 All numbers'),
      h('div', { class: 'table-wrap card' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Hero', 'Dealt', 'Taken', 'Healed', 'Kills', 'Downs', 'Attacks', 'Hit %', 'Crits', 'Nat 1s', 'Spells', 'Biggest hit'].map(t => h('th', {}, t)))),
        h('tbody', {}, pcs.sort((a, b) => b.dmgDealt - a.dmgDealt).map(a => h('tr', {},
          h('td', {}, a.name), h('td', {}, a.dmgDealt), h('td', {}, a.dmgTaken), h('td', {}, a.healing), h('td', {}, a.kills), h('td', {}, a.downs),
          h('td', {}, a.attacks), h('td', {}, a.attacks ? Math.round(a.hits / a.attacks * 100) + '%' : '—'), h('td', {}, a.crits), h('td', {}, a.fumbles),
          h('td', {}, a.spells), h('td', {}, a.maxHit ? `${a.maxHit} (${a.maxHitDesc})` : '—')))))));
  }

  if (dice.length) {
    root.append(h('h3', { class: 'sub-head' }, '🎲 Dice luck'),
      h('div', { class: 'table-wrap card' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Player', 'd20s', 'Average d20', 'vs. expected', 'Nat 20s', 'Nat 1s', 'All dice'].map(t => h('th', {}, t)))),
        h('tbody', {}, dice.sort((a, b) => avg(b[1]) - avg(a[1])).map(([name, d]) => {
          const av = avg(d);
          const diff = d.d20s ? av - 10.5 : 0;
          return h('tr', {}, h('td', {}, name), h('td', {}, d.d20s), h('td', {}, d.d20s ? av.toFixed(2) : '—'),
            h('td', { class: diff > 0.5 ? 'good' : diff < -0.5 ? 'bad' : '' }, d.d20s ? (diff >= 0 ? '▲ +' : '▼ ') + diff.toFixed(2) : '—'),
            h('td', {}, d.nat20), h('td', {}, d.nat1), h('td', {}, d.dice));
        })))));
  }

  if (foes.length) {
    const top = [...foes].sort((a, b) => b.dmgDealt - a.dmgDealt).slice(0, 8).filter(f => f.dmgDealt > 0);
    if (top.length) root.append(h('h3', { class: 'sub-head' }, '👹 Most dangerous foes'), h('div', { class: 'board-grid one' }, board('Damage dealt to the party', top, a => a.dmgDealt)));
  }
}

const avg = d => (d.d20s ? d.d20Sum / d.d20s : 0);

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('small', {}, label), h('b', {}, (value ?? 0).toLocaleString()), sub ? h('span', { class: 'muted' }, sub) : null);
}

function board(title, list, get, unit = '') {
  const rows = list.map(a => [a.name, get(a) || 0]).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  return h('div', { class: 'card board' },
    h('div', { class: 'section-title' }, title),
    rows.length ? h('div', { class: 'bars' }, rows.map(([name, v]) => h('div', { class: 'bar-row', title: `${name}: ${v}${unit}` },
      h('span', { class: 'bar-label' }, name),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: Math.max(v ? 2 : 0, v / max * 100) + '%' } })),
      h('b', {}, v + unit)))) : h('p', { class: 'muted' }, 'Not enough data yet'));
}

function computeAwards(pcs, dice, foes) {
  const out = [];
  const best = (list, get, min = 1) => {
    const top = [...list].sort((a, b) => get(b) - get(a))[0];
    return top && get(top) >= min ? top : null;
  };
  let a;
  if ((a = best(pcs, x => x.dmgDealt))) out.push({ icon: '🪓', title: 'The Butcher', name: a.name, detail: `${a.dmgDealt} total damage` });
  if ((a = best(pcs, x => x.maxHit))) out.push({ icon: '💥', title: 'Biggest Hit', name: a.name, detail: `${a.maxHit} — ${a.maxHitDesc}` });
  if ((a = best(pcs, x => x.healing))) out.push({ icon: '💚', title: 'Field Medic', name: a.name, detail: `${a.healing} HP restored` });
  if ((a = best(pcs, x => x.kills))) out.push({ icon: '☠️', title: 'Grim Reaper', name: a.name, detail: `${a.kills} kill${a.kills === 1 ? '' : 's'}` });
  if ((a = best(pcs, x => x.dmgTaken))) out.push({ icon: '🛡️', title: 'Punching Bag', name: a.name, detail: `${a.dmgTaken} damage absorbed` });
  if ((a = best(pcs.filter(x => x.attacks >= 5), x => x.hits / x.attacks, 0))) out.push({ icon: '🎯', title: 'Sharpshooter', name: a.name, detail: `${Math.round(a.hits / a.attacks * 100)}% of ${a.attacks} attacks hit` });
  if ((a = best(pcs, x => x.downs))) out.push({ icon: '🪦', title: "Death's Door Regular", name: a.name, detail: `Downed ${a.downs} time${a.downs === 1 ? '' : 's'}` });
  if ((a = best(pcs, x => x.spells))) out.push({ icon: '🔮', title: 'Arcane Battery', name: a.name, detail: `${a.spells} spell${a.spells === 1 ? '' : 's'} cast` });
  const rollers = dice.map(([name, d]) => ({ name, ...d })).filter(d => d.d20s >= 5);
  if ((a = best(rollers, d => d.d20Sum / d.d20s, 0))) out.push({ icon: '🍀', title: 'Blessed Dice', name: a.name, detail: `Avg d20 ${(a.d20Sum / a.d20s).toFixed(1)}` });
  if ((a = best(rollers, d => -(d.d20Sum / d.d20s), -21)) && rollers.length > 1) out.push({ icon: '🌧️', title: 'Cursed Dice', name: a.name, detail: `Avg d20 ${(a.d20Sum / a.d20s).toFixed(1)}` });
  if ((a = best(dice.map(([name, d]) => ({ name, ...d })), d => d.nat20))) out.push({ icon: '✨', title: 'Nat 20 Machine', name: a.name, detail: `${a.nat20} natural 20s` });
  if ((a = best(dice.map(([name, d]) => ({ name, ...d })), d => d.nat1))) out.push({ icon: '🤡', title: 'Fumble Royalty', name: a.name, detail: `${a.nat1} natural 1s` });
  if ((a = best(foes, x => x.dmgDealt))) out.push({ icon: '👹', title: 'Nemesis', name: a.name, detail: `Dealt ${a.dmgDealt} damage to the party` });
  return out;
}
