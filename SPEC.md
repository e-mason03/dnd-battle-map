# D&D Combat Map - Specification

## Project Overview
- **Project Name**: dnd-combat-map
- **Type**: Local web application (single HTML file with embedded CSS/JS)
- **Core Functionality**: Top-down 2D grid-based combat map for D&D sessions with terrain, tokens, and environmental features
- **Target Users**: D&D players and Dungeon Masters

## UI/UX Specification

### Layout Structure
- **Header**: App title, toolbar with map controls (40px height)
- **Main Area**: Full remaining viewport - the canvas grid
- **Sidebar** (right, 280px): Tabbed panel for terrain, tokens, features, settings
- **Footer**: Coordinate display, zoom level (28px height)

### Visual Design
- **Color Palette**:
  - Background: `#1a1a2e` (deep navy)
  - Panel Background: `#16213e` (darker blue)
  - Panel Border: `#0f3460` (muted blue)
  - Accent: `#e94560` (crimson)
  - Secondary Accent: `#f5a623` (gold)
  - Text Primary: `#eaeaea`
  - Text Secondary: `#a0a0a0`
  - Grid Lines: `rgba(255,255,255,0.15)`

- **Typography**:
  - Font Family: `"Cinzel", serif` for headers, `"Fira Sans", sans-serif` for UI
  - Header: 18px bold
  - UI Labels: 13px
  - Small Text: 11px

- **Spacing**: 8px base unit, panels use 12px padding

### Components

#### Grid System
- Default: 20x20 grid (configurable)
- Cell size: 40px (zoomable 20-80px)
- Grid lines visible with subtle styling
- Coordinate labels on edges (A1, B2, etc.)

#### Terrain Types (click to place on cells)
| Terrain | Color | Icon |
|---------|-------|------|
| Grass | `#4a7c59` | simple blade pattern |
| Stone | `#6b6b6b` | cracked stone |
| Dirt | `#8b6914` | dotted earth |
| Sand | `#d4b896` | speckled |
| Snow | `#e8e8e8` | snowflake |
| Water | `#2d5a7b` | wave pattern |
| Lava | `#cf4520` | flame pattern |
| Void | `#0a0a0f` | abyss |

#### Elevation Levels (shown as subtle shading/walls)
- Level 0: Flat (no indicator)
- Level 1: Low (thin border `#7a7a7a`)
- Level 2: Medium (medium border `#9a9a9a`)
- Level 3: High (thick border `#bbbbbb` + "▲" marker)
- Wall: Solid black border with brick pattern

#### Environmental Features
| Feature | Visual | Effect |
|---------|--------|--------|
| Ravine | Dark trench with depth | Difficult terrain |
| Water Pool | Blue with ripple | Difficult terrain |
| Stream | Flowing blue line | Difficult terrain |
| Fire | Orange/red animated glow | Damage zone |
| Web | White strands | Difficult terrain |
| Fog | Gray overlay | Concealment |
| Light | Yellow glow | Bright light source |
| Darkness | Black overlay | Dim/darkness |
| Spike | Gray triangles | Hazard |
| Trap | Red X marker | Hazard |

#### Token System
- Circular tokens (36px diameter within cell)
- Player classes: Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard
- Monster types: Dragon, Giant, Undead, Beast, Aberration, Construct, Elemental, Fey, Fiend, Humanoid, Monstrosity, Ooze, Plant
- Each type has distinct icon and color coding
- Health bar beneath token
- Name label optional

#### Toolbar Controls
- New Map / Clear Map buttons
- Grid size input (width x height)
- Zoom slider
- Pan mode / Place mode toggle
- Undo / Redo buttons

#### Sidebar Tabs
1. **Terrain**: Grid of terrain type buttons
2. **Elevation**: Level 0-3 and Wall buttons
3. **Features**: Grid of environmental feature buttons
4. **Tokens**: Searchable list of tokens, drag to place
5. **Settings**: Grid size, cell size, grid color, show coordinates toggle

### Interactions
- **Left Click**: Place selected terrain/feature/elevation
- **Right Click**: Remove terrain/feature/elevation from cell
- **Click + Drag**: Paint multiple cells
- **Token Placement**: Drag from sidebar onto grid
- **Pan**: Middle mouse or spacebar + drag
- **Zoom**: Mouse wheel or slider

## Functionality Specification

### Core Features
1. Dynamic grid rendering with configurable dimensions
2. Terrain painting with click and drag
3. Elevation level assignment per cell
4. Environmental feature placement
5. Token management (add, move, remove, edit HP)
6. Zoom and pan navigation
7. Undo/redo stack (last 50 actions)
8. Save/load map to localStorage
9. Export as PNG

### Data Structure
```javascript
cell = {
  terrain: string,
  elevation: number, // 0-3
  feature: string | null,
  token: { type, name, hp, maxHp, isPlayer } | null
}
map = {
  width: number,
  height: number,
  cells: Cell[][]
}
```

### Edge Cases
- Prevent placing tokens on occupied cells
- Handle window resize gracefully
- Maintain scroll position on tab switches

## Acceptance Criteria
1. Grid renders with correct dimensions on load
2. All terrain types can be painted and display correctly
3. All elevation levels display with distinct visuals
4. All features render with appropriate styling
5. Tokens can be dragged, placed, moved, and deleted
6. Zoom affects entire map view
7. Pan allows viewing off-screen areas
8. Undo/redo works for all actions
9. Map persists in localStorage
10. Export produces valid PNG image
