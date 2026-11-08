// ============================================================
// Constants — terrain, elevation, features, tokens, conditions,
// damage types, hexcrawl terrain & icons
// ============================================================

export const TERRAINS = {
  grass: { label: 'Grass', color: '#2d5c37' },
  stone: { label: 'Stone', color: '#4a4a4a' },
  wood:  { label: 'Wood',  color: '#5b3d22' },
  dirt:  { label: 'Dirt',  color: '#6b4a14' },
  sand:  { label: 'Sand',  color: '#b09060' },
  snow:  { label: 'Snow',  color: '#cccccc' },
  water: { label: 'Water', color: '#163c5a', difficult: true },
  lava:  { label: 'Lava',  color: '#9e2800' },
  void:  { label: 'Void',  color: '#04040a' },
  none:  { label: 'Clear', color: 'transparent' },
};

export const ELEVATIONS = [
  { level: 0, label: 'Flat',   bw: 0, bc: null,      marker: null },
  { level: 1, label: 'Low',    bw: 2, bc: '#7a7a7a', marker: null },
  { level: 2, label: 'Medium', bw: 3, bc: '#9a9a9a', marker: null },
  { level: 3, label: 'High',   bw: 4, bc: '#cccccc', marker: '▲' },
  { level: 4, label: 'Wall',   bw: 4, bc: '#222',    marker: null, isWall: true },
];

// light: [bright ft, dim ft] it sheds; lit: the cell itself is brightly lit;
// obscures: blocks line of sight (you see it, not past it)
export const FEATURES = {
  door:     { label: 'Door',    color: 'rgba(120,70,30,0.0)',  icon: '🚪', cover: 'total' },
  doorOpen: { label: 'Open Door', color: 'rgba(120,70,30,0.0)', icon: '🔓' },
  ravine:   { label: 'Ravine',  color: 'rgba(10,5,2,0.72)',    icon: '≋', difficult: true },
  pool:     { label: 'Pool',    color: 'rgba(20,70,110,0.65)', icon: '◉', difficult: true },
  stream:   { label: 'Stream',  color: 'rgba(30,90,150,0.55)', icon: '〜', difficult: true },
  fire:     { label: 'Fire',    color: 'rgba(180,60,0,0.55)',  icon: '🔥', light: [10, 20] },
  torch:    { label: 'Torch',   color: 'rgba(255,170,40,0.18)', icon: '🕯️', light: [20, 40] },
  web:      { label: 'Web',     color: 'rgba(180,180,180,0.35)', icon: '✦', difficult: true },
  rubble:   { label: 'Rubble',  color: 'rgba(90,80,70,0.55)',  icon: '⁂', difficult: true },
  fog:      { label: 'Fog',     color: 'rgba(140,140,155,0.55)', icon: '◌', obscures: true },
  light:    { label: 'Light',   color: 'rgba(255,220,60,0.28)', icon: '☀', lit: true },
  darkness: { label: 'Dark',    color: 'rgba(0,0,10,0.75)',    icon: '◼', obscures: true },
  spike:    { label: 'Spikes',  color: 'rgba(110,110,110,0.6)', icon: '△' },
  trap:     { label: 'Trap',    color: 'rgba(190,0,0,0.45)',   icon: '✕' },
  chest:    { label: 'Chest',   color: 'rgba(0,0,0,0)',        icon: '🧰' },

  // Obstacles — `cover` is the most cover they can give; `blocks` makes them impassable
  crate:    { label: 'Crate',    color: 'rgba(0,0,0,0)', icon: '📦', obstacle: true, cover: 'half', difficult: true },
  barrel:   { label: 'Barrel',   color: 'rgba(0,0,0,0)', icon: '🛢️', obstacle: true, cover: 'half', difficult: true },
  table:    { label: 'Table',    color: 'rgba(0,0,0,0)', icon: '▭', obstacle: true, cover: 'half', difficult: true },
  lowWall:  { label: 'Low Wall', color: 'rgba(0,0,0,0)', icon: '🧱', obstacle: true, cover: 'half', difficult: true },
  boulder:  { label: 'Boulder',  color: 'rgba(0,0,0,0)', icon: '🪨', obstacle: true, cover: 'three', blocks: true },
  pillar:   { label: 'Pillar',   color: 'rgba(0,0,0,0)', icon: '🏛️', obstacle: true, cover: 'three', blocks: true },
  tree:     { label: 'Tree',     color: 'rgba(0,0,0,0)', icon: '🌳', obstacle: true, cover: 'three', blocks: true },
  statue:   { label: 'Statue',   color: 'rgba(0,0,0,0)', icon: '🗿', obstacle: true, cover: 'three', blocks: true },
};

export const PLAYER_TOKENS = [
  { type: 'barbarian', label: 'Barbarian', abbr: 'Ba', color: '#c0392b' },
  { type: 'bard',      label: 'Bard',      abbr: 'Bd', color: '#8e44ad' },
  { type: 'cleric',    label: 'Cleric',    abbr: 'Cl', color: '#b7950b' },
  { type: 'druid',     label: 'Druid',     abbr: 'Dr', color: '#1e8449' },
  { type: 'fighter',   label: 'Fighter',   abbr: 'Fi', color: '#1f618d' },
  { type: 'monk',      label: 'Monk',      abbr: 'Mo', color: '#148f77' },
  { type: 'paladin',   label: 'Paladin',   abbr: 'Pa', color: '#d4ac0d' },
  { type: 'ranger',    label: 'Ranger',    abbr: 'Ra', color: '#196f3d' },
  { type: 'rogue',     label: 'Rogue',     abbr: 'Ro', color: '#616a6b' },
  { type: 'sorcerer',  label: 'Sorcerer',  abbr: 'So', color: '#7d3c98' },
  { type: 'warlock',   label: 'Warlock',   abbr: 'Wl', color: '#4a235a' },
  { type: 'wizard',    label: 'Wizard',    abbr: 'Wi', color: '#1a5276' },
  { type: 'artificer', label: 'Artificer', abbr: 'Ar', color: '#9c640c' },
];

// Generic monsters come with a sensible default stat block (darkvision in ft)
export const MONSTER_TOKENS = [
  { type: 'humanoid',    label: 'Bandit',      abbr: 'Hu', color: '#424949', hp: 11, ac: 12, actions: 'Scimitar | melee | 3 | 1d6+1 slashing | 5\nLight Crossbow | ranged | 3 | 1d8+1 piercing | 80' },
  { type: 'goblin',      label: 'Goblin',      abbr: 'Gb', color: '#4d6b2f', hp: 7, ac: 15, darkvision: 60, actions: 'Scimitar | melee | 4 | 1d6+2 slashing | 5\nShortbow | ranged | 4 | 1d6+2 piercing | 80' },
  { type: 'beast',       label: 'Wolf',        abbr: 'Be', color: '#935116', hp: 11, ac: 13, speed: 40, actions: 'Bite | melee | 4 | 2d4+2 piercing | 5' },
  { type: 'undead',      label: 'Skeleton',    abbr: 'Un', color: '#717d7e', hp: 13, ac: 13, darkvision: 60, actions: 'Shortsword | melee | 4 | 1d6+2 piercing | 5\nShortbow | ranged | 4 | 1d6+2 piercing | 80' },
  { type: 'monstrosity', label: 'Owlbear',     abbr: 'Mn', color: '#5b2333', hp: 59, ac: 13, darkvision: 60, actions: 'Beak | melee | 7 | 1d10+5 piercing | 5\nClaws | melee | 7 | 2d8+5 slashing | 5' },
  { type: 'giant',       label: 'Ogre',        abbr: 'Gi', color: '#5d6d7e', hp: 59, ac: 11, darkvision: 60, actions: 'Greatclub | melee | 6 | 2d8+4 bludgeoning | 5\nJavelin | ranged | 6 | 2d6+4 piercing | 30' },
  { type: 'dragon',      label: 'Young Dragon', abbr: 'Dg', color: '#7b241c', hp: 178, ac: 18, speed: 40, darkvision: 120, actions: 'Bite | melee | 10 | 2d10+6 piercing | 10\nClaw | melee | 10 | 2d6+6 slashing | 5\nFire Breath | save:dex | 17 | 16d6 fire | 30 | 30 cone' },
  { type: 'aberration',  label: 'Aberration',  abbr: 'Ab', color: '#4a235a', hp: 40, ac: 14, darkvision: 120, actions: 'Tentacle | melee | 5 | 2d6+3 bludgeoning | 10\nMind Blast | save:int | 13 | 3d8 psychic | 60 | 15' },
  { type: 'construct',   label: 'Construct',   abbr: 'Co', color: '#566573', hp: 33, ac: 18, darkvision: 60, actions: 'Slam | melee | 4 | 1d6+2 bludgeoning | 5' },
  { type: 'elemental',   label: 'Elemental',   abbr: 'El', color: '#a04000', hp: 102, ac: 13, darkvision: 60, actions: 'Touch | melee | 6 | 2d6+3 fire | 5' },
  { type: 'fey',         label: 'Fey',         abbr: 'Fe', color: '#b03a8e', hp: 22, ac: 15, darkvision: 60, actions: 'Thorn Dart | ranged | 5 | 1d8+3 piercing | 60' },
  { type: 'fiend',       label: 'Fiend',       abbr: 'Fn', color: '#7b241c', hp: 45, ac: 15, darkvision: 120, actions: 'Claw | melee | 6 | 2d6+4 slashing | 5\nHellfire | spell | 5 | 3d6 fire | 60' },
  { type: 'ooze',        label: 'Ooze',        abbr: 'Oz', color: '#1d8348', hp: 22, ac: 8, speed: 10, darkvision: 60, actions: 'Pseudopod | melee | 3 | 1d6+1 acid | 5' },
  { type: 'plant',       label: 'Plant',       abbr: 'Pl', color: '#145a32', hp: 30, ac: 12, actions: 'Vine Lash | melee | 4 | 1d8+2 bludgeoning | 10' },
  { type: 'npc',         label: 'NPC',         abbr: 'NP', color: '#2e6b8a', hp: 10, ac: 10, actions: 'Club | melee | 2 | 1d4 bludgeoning | 5' },
];

export const ALL_TOKENS = [...PLAYER_TOKENS, ...MONSTER_TOKENS];

// Monster portraits shown when hovering a token (public/img/monsters/<slug>.jpg).
// To add one, drop a resized image in that folder and list its slug here.
export const MONSTER_ART = {
  'bandit': 'Bandit', 'death-dog': 'Death Dog', 'goblin': 'Goblin', 'green-hag': 'Green Hag', 'lich': 'Lich',
  'night-hag': 'Night Hag', 'skeleton': 'Skeleton', 'skeleton-archer': 'Skeleton Archer', 'vampire': 'Vampire',
  'vampire-spawn': 'Vampire Spawn', 'wolf': 'Wolf', 'zombie': 'Zombie',
};
// Art painted as a full scene rather than on a white background; the card
// shows these edge to edge instead of blending them into the parchment
export const SCENE_ART = new Set(['skeleton-archer']);

const artSlug = name => String(name || '').toLowerCase().replace(/\s+\d+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Portrait for a token: { url, scene } or null. token.art: undefined = match
// by name ("Goblin 3" → goblin), 'none' = never, otherwise a MONSTER_ART slug.
export function monsterArt(t) {
  if (!t || t.charId || t.art === 'none') return null;
  const slug = t.art && MONSTER_ART[t.art] ? t.art : artSlug(t.name);
  return MONSTER_ART[slug] ? { url: `img/monsters/${slug}.jpg`, scene: SCENE_ART.has(slug) } : null;
}

export const monsterArtUrl = t => monsterArt(t)?.url || null;
export const tokenDef = type => ALL_TOKENS.find(t => t.type === type) || MONSTER_TOKENS[0];

export const CONDITIONS = [
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
  'concentrating', 'blessed', 'hasted', 'raging', 'outlined', 'half cover', 'three-quarters cover', 'dead',
];

export const DAMAGE_COLORS = {
  fire: '#ff7a1a', cold: '#7fd7ff', lightning: '#ffe94d', thunder: '#9db4ff', acid: '#9cff3a',
  poison: '#5fd35f', necrotic: '#9b59b6', radiant: '#ffe9a6', force: '#ff5ce1', psychic: '#ff7ab8',
  slashing: '#f2f2f2', piercing: '#e6e6e6', bludgeoning: '#d9d0c0', healing: '#58ff9a',
};

export const HEX_TERRAINS = {
  plains:    { label: 'Plains',    color: '#7d9b4c' },
  grassland: { label: 'Grassland', color: '#93b25a' },
  forest:    { label: 'Forest',    color: '#2f6b3a' },
  jungle:    { label: 'Jungle',    color: '#1e5a2a' },
  hills:     { label: 'Hills',     color: '#9a8a55' },
  mountains: { label: 'Mountains', color: '#7b746a' },
  swamp:     { label: 'Swamp',     color: '#4a5d3a' },
  desert:    { label: 'Desert',    color: '#d6b46a' },
  tundra:    { label: 'Tundra',    color: '#c9d6db' },
  water:     { label: 'Water',     color: '#2e5f8a' },
  deep:      { label: 'Deep Sea',  color: '#1b3d63' },
  badlands:  { label: 'Badlands',  color: '#9c5a3a' },
  farmland:  { label: 'Farmland',  color: '#b4a24e' },
};

export const HEX_ICONS = {
  city: '🏰', village: '🏘️', tower: '🗼', ruins: '🏛️', cave: '🕳️', dungeon: '💀', camp: '⛺',
  temple: '⛩️', port: '⚓', portal: '🌀', treasure: '💎', danger: '⚠️', lair: '🐉', shrine: '🕯️',
  mine: '⛏️', inn: '🍺', quest: '❗', tree: '🌳',
};
