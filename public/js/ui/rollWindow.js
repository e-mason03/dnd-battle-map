// ============================================================
// Roll window — players roll their own attack and damage dice.
//   Attacks:  roll to hit → the room says hit / miss (AC stays secret)
//             → roll damage for the hits → Strike!
//   Saves, auto-hits and heals: a single damage / healing roll.
// Once the first die is rolled the window can't be dismissed, so a bad
// roll can't be quietly retried.
// ============================================================

import { roll, rollD20 } from '../core/dice.js';
import { actionOp } from '../core/actions.js';
import { COVER_BONUS, COVER_LABEL } from '../core/cover.js';
import { checkAttacks } from '../net.js';
import { h } from './dom.js';

const ATTACK_KINDS = new Set(['melee', 'ranged', 'spell']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = n => (n >= 0 ? '+' : '') + n;

// Cycles random faces on each die element, then lands on the real values
async function tumble(els, finals, sides) {
  const t0 = performance.now();
  els.forEach(e => e.classList.add('rolling'));
  while (performance.now() - t0 < 650) {
    els.forEach((e, i) => { e.textContent = 1 + Math.floor(Math.random() * sides[i]); });
    await sleep(45);
  }
  els.forEach((e, i) => {
    e.textContent = finals[i];
    e.classList.remove('rolling');
    e.classList.toggle('max', finals[i] === sides[i]);
    e.classList.toggle('min', finals[i] === 1);
  });
}

const dieEl = sides => h('span', { class: `rdie d${sides}` }, '?');

/**
 * actor:   token view of the creature acting
 * action:  the chosen action (already upcast to the slot being spent)
 * targets: token views, each with `cover`
 * onCommit(op): called once with the finished 'battle.action' op
 */
export function openRollWindow({ actor, action, targets, adv = 0, point = null, onCommit }) {
  const isAttack = ATTACK_KINDS.has(action.kind);
  const results = targets.map(t => {
    const r = { targetId: t.id, targetName: t.name };
    const coverApplies = isAttack || (action.kind === 'save' && action.save === 'dex');
    if (coverApplies && COVER_BONUS[t.cover]) r.cover = t.cover;
    return r;
  });
  let locked = false;

  const overlay = h('div', { class: 'modal-overlay open roll-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key === 'Escape' && !locked) { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  const body = h('div', { class: 'roll-body' });
  const footer = h('div', { class: 'modal-btns' });
  const cancelBtn = h('button', { class: 'btn', onclick: close }, 'Cancel');

  const sub = action.kind === 'save' ? `DC ${action.dc} ${action.save.toUpperCase()} save`
    : action.kind === 'heal' ? 'Healing'
    : action.kind === 'auto' ? 'Always hits'
    : `${fmt(action.bonus || 0)} to hit` + (adv > 0 ? ' · advantage' : adv < 0 ? ' · disadvantage' : '');
  overlay.append(h('div', { class: 'modal roll-modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h3', {}, `${actor.name} — ${action.name}`), h('small', { class: 'muted' }, sub)),
    ),
    body, footer));
  document.body.append(overlay);

  const commit = () => {
    close();
    onCommit(actionOp(actor, action, results, point));
  };

  if (isAttack) attackStep();
  else effectStep();

  // ---------- Step 1 (attacks): roll to hit ----------
  function attackStep() {
    const rows = results.map(r => {
      const dice = (adv ? [20, 20] : [20]).map(dieEl);
      const total = h('b', { class: 'roll-total' }, '?');
      const outcome = h('span', { class: 'outcome' });
      const row = h('div', { class: 'roll-row' },
        h('span', { class: 'roll-target' }, r.targetName, r.cover ? h('small', { class: 'cover-note' }, ` 🛡 ${COVER_LABEL[r.cover]}`) : null),
        h('span', { class: 'roll-dice' }, dice), h('span', { class: 'muted' }, fmt(action.bonus || 0), ' ='), total, outcome);
      return { r, dice, total, outcome, row };
    });
    const rollBtn = h('button', { class: 'btn primary big', onclick: rollToHit }, '🎲 Roll to hit');
    body.append(h('div', { class: 'roll-step' }, h('div', { class: 'section-title' }, 'Attack roll'), rows.map(x => x.row)));
    footer.append(cancelBtn, rollBtn);

    async function rollToHit() {
      locked = true;
      cancelBtn.remove();
      rollBtn.disabled = true;
      for (const x of rows) {
        const d = rollD20(adv);
        x.r.attack = { rolls: d.rolls, value: d.value, bonus: action.bonus || 0, total: d.value + (action.bonus || 0), adv };
      }
      await Promise.all(rows.map(x => tumble(x.dice, x.r.attack.rolls, x.r.attack.rolls.map(() => 20))));
      rows.forEach(x => {
        x.total.textContent = x.r.attack.total;
        if (adv && x.dice.length === 2) {
          const keep = x.r.attack.rolls.indexOf(x.r.attack.value);
          x.dice[1 - keep].classList.add('dropped');
        }
        x.outcome.textContent = '…';
      });

      let verdicts;
      try {
        verdicts = await checkAttacks(actor.id, rows.map(x => ({ targetId: x.r.targetId, cover: x.r.cover, attack: x.r.attack })));
      } catch {
        // Can't reach the room: roll damage for everything; the room still
        // applies it only where the attack actually hit
        verdicts = rows.map(x => ({ hit: x.r.attack.value !== 1, crit: x.r.attack.value === 20, unknown: true }));
      }
      rows.forEach((x, i) => {
        const v = verdicts[i];
        x.hit = v.hit;
        x.crit = v.crit;
        x.outcome.textContent = v.unknown ? '?' : v.crit ? 'CRITICAL!' : v.hit ? 'HIT' : 'MISS';
        x.outcome.className = 'outcome ' + (v.unknown ? '' : v.crit ? 'crit' : v.hit ? 'hit' : 'miss');
      });
      rollBtn.remove();

      const hits = rows.filter(x => x.hit);
      if (!hits.length || !action.damage) {
        rows.forEach(x => { x.r.dmgRoll = 0; });
        footer.append(h('button', { class: 'btn primary big', onclick: commit }, hits.length ? '⚔ Strike!' : 'Done'));
        return;
      }
      rows.filter(x => !x.hit).forEach(x => { x.r.dmgRoll = 0; });
      damageStep(hits.map(x => ({ r: x.r, crit: x.crit })));
    }
  }

  // ---------- Step 2 (attacks): roll damage for each hit ----------
  function damageStep(hits) {
    if (isFixed(action.damage)) {
      // e.g. an unarmed strike: flat damage, nothing to roll (crits double dice only)
      const amount = roll(action.damage).total;
      hits.forEach(({ r }) => { r.dmgRoll = amount; });
      body.append(fixedStep('Damage', amount, action.dmgType, hits.map(x => x.r.targetName)));
      footer.append(h('button', { class: 'btn primary big', onclick: commit }, '⚔ Strike!'));
      return;
    }
    const rows = hits.map(({ r, crit }) => {
      const preview = roll(action.damage, { crit });          // only to know how many dice to draw
      const dice = preview.rolls.map(d => dieEl(d.sides));
      const total = h('b', { class: 'roll-total' }, '?');
      const row = h('div', { class: 'roll-row' },
        h('span', { class: 'roll-target' }, r.targetName, crit ? h('small', { class: 'crit-note' }, ' crit — dice doubled') : null),
        h('span', { class: 'roll-dice' }, dice), modNote(preview.mod), total, h('span', { class: 'muted' }, action.dmgType || ''));
      return { r, crit, dice, total, row };
    });
    const rollBtn = h('button', { class: 'btn primary big', onclick: rollDamage }, '🎲 Roll damage');
    body.append(h('div', { class: 'roll-step' }, h('div', { class: 'section-title' }, `Damage · ${action.damage} ${action.dmgType || ''}`), rows.map(x => x.row)));
    footer.append(rollBtn);

    async function rollDamage() {
      rollBtn.disabled = true;
      const rolled = rows.map(x => roll(action.damage, { crit: x.crit }));
      await Promise.all(rows.map((x, i) => tumble(x.dice, rolled[i].rolls.map(d => d.value), rolled[i].rolls.map(d => d.sides))));
      rows.forEach((x, i) => { x.r.dmgRoll = rolled[i].total; x.total.textContent = rolled[i].total; });
      rollBtn.remove();
      footer.append(h('button', { class: 'btn primary big', onclick: commit }, '⚔ Strike!'));
    }
  }

  // ---------- Saves, auto-hits, heals: one roll ----------
  function effectStep() {
    const heal = action.kind === 'heal';
    const shared = action.kind === 'save';  // one damage roll for every creature in a save effect
    const notation = action.damage || (heal ? '1d4' : '');
    if (!notation) {
      // e.g. a save spell with no damage: nothing to roll, the targets save
      body.append(h('p', { class: 'muted' }, savesNote()));
      footer.append(cancelBtn, h('button', { class: 'btn primary big', onclick: () => { prepareSaves(); results.forEach(r => { r.dmgRoll = 0; }); commit(); } }, '✨ Cast'));
      return;
    }
    if (isFixed(notation)) {
      const amount = roll(notation).total;
      results.forEach(r => { if (heal) r.heal = amount; else r.dmgRoll = amount; });
      body.append(fixedStep(heal ? 'Healing' : 'Damage', amount, heal ? 'HP' : action.dmgType, results.map(r => r.targetName)));
      if (action.kind === 'save') body.append(h('p', { class: 'hint' }, savesNote()));
      footer.append(cancelBtn, h('button', { class: 'btn primary big', onclick: () => { prepareSaves(); commit(); } }, heal ? '💚 Heal!' : '✨ Cast!'));
      return;
    }
    const groups = shared ? [{ label: results.length === 1 ? results[0].targetName : `${results.length} creatures`, rs: results }]
      : results.map(r => ({ label: r.targetName, rs: [r] }));
    const rows = groups.map(g => {
      const preview = roll(notation);
      const dice = preview.rolls.map(d => dieEl(d.sides));
      const total = h('b', { class: 'roll-total' }, '?');
      const row = h('div', { class: 'roll-row' }, h('span', { class: 'roll-target' }, g.label),
        h('span', { class: 'roll-dice' }, dice), modNote(preview.mod), total, h('span', { class: 'muted' }, heal ? 'HP' : action.dmgType || ''));
      return { g, dice, total, row };
    });
    const rollBtn = h('button', { class: 'btn primary big', onclick: rollEffect }, heal ? '🎲 Roll healing' : '🎲 Roll damage');
    body.append(h('div', { class: 'roll-step' },
      h('div', { class: 'section-title' }, `${heal ? 'Healing' : 'Damage'} · ${notation} ${heal ? '' : action.dmgType || ''}`),
      rows.map(x => x.row),
      action.kind === 'save' ? h('p', { class: 'hint' }, savesNote()) : null));
    footer.append(cancelBtn, rollBtn);

    async function rollEffect() {
      locked = true;
      cancelBtn.remove();
      rollBtn.disabled = true;
      const rolled = rows.map(() => roll(notation));
      await Promise.all(rows.map((x, i) => tumble(x.dice, rolled[i].rolls.map(d => d.value), rolled[i].rolls.map(d => d.sides))));
      rows.forEach((x, i) => {
        x.total.textContent = rolled[i].total;
        for (const r of x.g.rs) {
          if (heal) r.heal = rolled[i].total;
          else r.dmgRoll = rolled[i].total;
        }
      });
      prepareSaves();
      rollBtn.remove();
      footer.append(h('button', { class: 'btn primary big', onclick: commit }, heal ? '💚 Heal!' : '✨ Cast!'));
    }
  }

  // Targets' saving throws are rolled for them; the room adds their bonuses
  function prepareSaves() {
    if (action.kind !== 'save') return;
    for (const r of results) r.save = { ability: action.save, dc: action.dc, d20: rollD20().value };
  }

  function savesNote() {
    return `Each target makes a DC ${action.dc} ${action.save.toUpperCase()} save` +
      (action.half !== false ? ' — half damage on a success.' : '.');
  }
}

// True when a damage expression has no dice (e.g. "4"), so there's nothing to roll
const isFixed = notation => !/d\d/i.test(String(notation || ''));

function fixedStep(title, amount, type, names) {
  return h('div', { class: 'roll-step' },
    h('div', { class: 'section-title' }, title),
    h('div', { class: 'roll-row' },
      h('span', { class: 'roll-target' }, names.join(', ')),
      h('span', { class: 'muted' }, 'fixed — no dice to roll'), h('span'),
      h('b', { class: 'roll-total' }, amount), h('span', { class: 'muted' }, type || '')));
}

function modNote(mod) {
  return mod ? h('span', { class: 'muted' }, fmt(mod), ' =') : h('span', { class: 'muted' }, '=');
}
