// ============================================================
// Constants — terrain, elevation, feature, and token definitions
// ============================================================

const TERRAINS = {
  grass: { label: 'Grass', color: '#2d5c37', border: '#4a7c59' },
  stone: { label: 'Stone', color: '#4a4a4a', border: '#6b6b6b' },
  dirt:  { label: 'Dirt',  color: '#6b4a14', border: '#8b6914' },
  sand:  { label: 'Sand',  color: '#b09060', border: '#d4b896' },
  snow:  { label: 'Snow',  color: '#cccccc', border: '#e8e8e8' },
  water: { label: 'Water', color: '#163c5a', border: '#2d5a7b' },
  lava:  { label: 'Lava',  color: '#9e2800', border: '#cf4520' },
  void:  { label: 'Void',  color: '#04040a', border: '#0a0a1f' },
};

const ELEVATIONS = [
  { level: 0, label: 'Flat',   bw: 0, bc: null,      marker: null,  isWall: false },
  { level: 1, label: 'Low',    bw: 2, bc: '#7a7a7a', marker: null,  isWall: false },
  { level: 2, label: 'Medium', bw: 3, bc: '#9a9a9a', marker: null,  isWall: false },
  { level: 3, label: 'High',   bw: 4, bc: '#cccccc', marker: '\u25B2',  isWall: false },
  { level: 4, label: 'Wall',   bw: 4, bc: '#222',    marker: null,  isWall: true  },
];

const FEATURES = {
  ravine:   { label: 'Ravine',   color: 'rgba(10,5,2,0.72)',   icon: '\u224B' },
  pool:     { label: 'Pool',     color: 'rgba(20,70,110,0.65)', icon: '\u25C9' },
  stream:   { label: 'Stream',   color: 'rgba(30,90,150,0.55)', icon: '\u301C' },
  fire:     { label: 'Fire',     color: 'rgba(180,60,0,0.55)',  icon: '\uD83D\uDD25' },
  web:      { label: 'Web',      color: 'rgba(180,180,180,0.35)',icon: '\u2726' },
  fog:      { label: 'Fog',      color: 'rgba(140,140,155,0.55)',icon: '\u25CC' },
  light:    { label: 'Light',    color: 'rgba(255,220,60,0.28)', icon: '\u2600' },
  darkness: { label: 'Dark',     color: 'rgba(0,0,10,0.75)',    icon: '\u25FC' },
  spike:    { label: 'Spikes',   color: 'rgba(110,110,110,0.6)', icon: '\u25B3' },
  trap:     { label: 'Trap',     color: 'rgba(190,0,0,0.45)',   icon: '\u2715' },
};

const PLAYER_TOKENS = [
  { type:'barbarian', label:'Barbarian', abbr:'Ba', color:'#c0392b', isPlayer:true },
  { type:'bard',      label:'Bard',      abbr:'Bd', color:'#8e44ad', isPlayer:true },
  { type:'cleric',    label:'Cleric',    abbr:'Cl', color:'#b7950b', isPlayer:true },
  { type:'druid',     label:'Druid',     abbr:'Dr', color:'#1e8449', isPlayer:true },
  { type:'fighter',   label:'Fighter',   abbr:'Fi', color:'#1f618d', isPlayer:true },
  { type:'monk',      label:'Monk',      abbr:'Mo', color:'#148f77', isPlayer:true },
  { type:'paladin',   label:'Paladin',   abbr:'Pa', color:'#d4ac0d', isPlayer:true },
  { type:'ranger',    label:'Ranger',    abbr:'Ra', color:'#196f3d', isPlayer:true },
  { type:'rogue',     label:'Rogue',     abbr:'Ro', color:'#616a6b', isPlayer:true },
  { type:'sorcerer',  label:'Sorcerer',  abbr:'So', color:'#7d3c98', isPlayer:true },
  { type:'warlock',   label:'Warlock',   abbr:'Wl', color:'#4a235a', isPlayer:true },
  { type:'wizard',    label:'Wizard',    abbr:'Wi', color:'#1a5276', isPlayer:true },
];

const MONSTER_TOKENS = [
  { type:'dragon',      label:'Dragon',      abbr:'Dg', color:'#7b241c', isPlayer:false },
  { type:'giant',       label:'Giant',       abbr:'Gi', color:'#5d6d7e', isPlayer:false },
  { type:'undead',      label:'Undead',      abbr:'Un', color:'#717d7e', isPlayer:false },
  { type:'beast',       label:'Beast',       abbr:'Be', color:'#935116', isPlayer:false },
  { type:'aberration',  label:'Aberration',  abbr:'Ab', color:'#4a235a', isPlayer:false },
  { type:'construct',   label:'Construct',   abbr:'Co', color:'#566573', isPlayer:false },
  { type:'elemental',   label:'Elemental',   abbr:'El', color:'#a04000', isPlayer:false },
  { type:'fey',         label:'Fey',         abbr:'Fe', color:'#b03a8e', isPlayer:false },
  { type:'fiend',       label:'Fiend',       abbr:'Fn', color:'#7b241c', isPlayer:false },
  { type:'humanoid',    label:'Humanoid',    abbr:'Hu', color:'#424949', isPlayer:false },
  { type:'monstrosity', label:'Monstrosity', abbr:'Mn', color:'#5b2333', isPlayer:false },
  { type:'ooze',        label:'Ooze',        abbr:'Oz', color:'#1d8348', isPlayer:false },
  { type:'plant',       label:'Plant',       abbr:'Pl', color:'#145a32', isPlayer:false },
];

const ALL_TOKENS = [...PLAYER_TOKENS, ...MONSTER_TOKENS];
