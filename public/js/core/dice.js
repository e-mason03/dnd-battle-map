// ============================================================
// Dice notation + probability helpers
// ============================================================

// Parses "2d6+1d4+3" → { dice: [{count, sides, sign}], mod }
export function parseDice(notation) {
  const out = { dice: [], mod: 0 };
  const src = String(notation || '').toLowerCase().replace(/\s+/g, '');
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[3]) {
      out.dice.push({ count: parseInt(m[2] || '1', 10), sides: parseInt(m[3], 10), sign: m[1] === '-' ? -1 : 1 });
    } else if (m[5]) {
      out.mod += (m[4] === '-' ? -1 : 1) * parseInt(m[5], 10);
    }
  }
  return out;
}

export const rollDie = sides => 1 + Math.floor(Math.random() * sides);

// Rolls a notation. crit=true doubles the number of dice.
export function roll(notation, { crit = false } = {}) {
  const p = parseDice(notation);
  const rolls = [];
  let total = p.mod;
  for (const d of p.dice) {
    const n = Math.min(100, d.count * (crit ? 2 : 1));
    for (let i = 0; i < n; i++) {
      const v = rollDie(d.sides);
      rolls.push({ sides: d.sides, value: v });
      total += d.sign * v;
    }
  }
  return { total: Math.max(0, total), rolls, mod: p.mod };
}

// d20 with advantage (adv > 0) / disadvantage (adv < 0)
export function rollD20(adv = 0) {
  const a = rollDie(20);
  if (!adv) return { rolls: [a], value: a };
  const b = rollDie(20);
  return { rolls: [a, b], value: adv > 0 ? Math.max(a, b) : Math.min(a, b) };
}

export function averageOf(notation) {
  const p = parseDice(notation);
  return p.dice.reduce((s, d) => s + d.sign * d.count * (d.sides + 1) / 2, p.mod);
}
