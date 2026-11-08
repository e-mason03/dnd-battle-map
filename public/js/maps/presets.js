// ============================================================
// Built-in battle maps a DM can load into any room. Layouts are
// drawn as text, one character per cell (see LEGEND).
// ============================================================

import { MONSTER_TOKENS } from '../constants.js';
import { parseActionText } from '../core/actions.js';
import { uid } from '../core/util.js';

// char → cell. Elevation 1–3 are ledges, 4 is a wall.
const LEGEND = {
  '#': { terrain: 'stone', elevation: 4 },
  '.': { terrain: 'stone' },
  ',': { terrain: 'dirt' },
  '1': { terrain: 'stone', elevation: 1 },
  '2': { terrain: 'stone', elevation: 2 },
  '3': { terrain: 'stone', elevation: 3 },
  'n': { terrain: 'dirt', elevation: 3 },                     // nest on the high ledge
  'L': { terrain: 'lava' },
  'r': { terrain: 'dirt', feature: 'rubble' },
  'o': { terrain: 'stone', feature: 'boulder' },
  'P': { terrain: 'stone', feature: 'pillar' },               // stalagmite
  'C': { terrain: 'dirt', elevation: 3, feature: 'chest' },   // the owlbears' hoard
};

function fromText(rows) {
  const height = rows.length, width = rows[0].length;
  const cells = rows.map((line, r) => {
    if (line.length !== width) throw new Error(`Row ${r} is ${line.length} wide, expected ${width}`);
    return [...line].map(ch => {
      const def = LEGEND[ch];
      if (!def) throw new Error(`Unknown map character "${ch}"`);
      return { terrain: def.terrain, elevation: def.elevation || 0, feature: def.feature || null };
    });
  });
  return { width, height, cells };
}

function monster(type, col, row, overrides = {}) {
  const m = MONSTER_TOKENS.find(x => x.type === type);
  return {
    id: 't-' + uid(8), type, name: m.label, col, row, size: m.size ?? 1,
    color: m.color, hp: m.hp, maxHp: m.hp, ac: m.ac, speed: m.speed || 30, initBonus: m.initBonus ?? 1,
    side: 'enemy', darkvision: m.darkvision || 0, actions: parseActionText(m.actions), saves: { ...(m.saves || {}) },
    conditions: [], ...overrides,
  };
}

// ------------------------------------------------------------

const OWLBEARS_LAIR = [
  '#############################',
  '###########....#####1112#####',
  '#######......,,,..###11223###',
  '#####.....,,,...,....1122333#',
  '####....o.....,,......11233n#',
  '###.....,,......P.....1122nn#',
  ',,.......,,,,.........,112nC#',
  ',,,.....LLL............,11nn#',
  ',,,....LLLL..r.....o....,1n##',
  '###....LLL..rr...........,,##',
  '####.....,..........P.....,##',
  '#####..o......,,,,.........##',
  '######.......,,,11,,.....o###',
  '#######..P..,,1122,.......###',
  '########.....,1111......#####',
  '###########.....,.....#######',
  '################....#########',
  '#############################',
];

export const PRESET_MAPS = [
  {
    name: "Owlbears' Lair",
    description: 'A cave with ledges climbing to a nest, a small lava pool and two owlbears.',
    // Where the party's tokens are moved to when the map loads (the west tunnel)
    start: [[1, 7], [0, 7], [1, 6], [0, 6], [2, 7], [1, 8], [0, 8], [2, 8], [2, 6]],
    build: () => ({
      map: { ...fromText(OWLBEARS_LAIR), bg: null, vision: { mode: 'off', ambient: 'dark' } },
      tokens: [
        monster('monstrosity', 25, 5, { name: 'Owlbear' }),      // guarding the nest and its hoard
        monster('monstrosity', 14, 8, { name: 'Owlbear 2' }),    // prowling near the lava
      ],
    }),
  },
];

// The map and tokens to load, with the party's PC tokens moved to the
// preset's start cells (PCs beyond the start cells are left off the map)
export function presetMapOp(preset, currentTokens) {
  const { map, tokens } = preset.build();
  const out = Object.fromEntries(tokens.map(t => [t.id, t]));
  const pcs = Object.values(currentTokens).filter(t => t.charId);
  pcs.slice(0, preset.start.length).forEach((t, i) => {
    out[t.id] = { ...t, col: preset.start[i][0], row: preset.start[i][1] };
  });
  return { type: 'battle.setMap', map, tokens: out };
}
