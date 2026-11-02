# D&D Table — Specification

All-in-one virtual tabletop for a home D&D group: tactical battle map, hexcrawl
overland map, party sheets imported from D&D Beyond, a campaign journal and fun stats.
Runs on Cloudflare Workers + one Durable Object per room.

## Running

```
npm install
npm run dev      # wrangler dev → http://localhost:8787
npm run check    # unit tests for the shared reducer, dice, hex math, DDB import
npm run deploy   # wrangler deploy
```

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Worker router | `src/index.ts` | `/api/rooms/*` → room Durable Object, everything else → static `public/` |
| Room Durable Object | `src/index.ts` (`BattleMapDO`) | SQLite tables: `kv` (state sections), `sessions`, `files` + `file_chunks` (images, 1 MB chunks, 12 MB max) |
| Shared reducer | `public/js/core/ops.js` | Imported by **both** the Worker and the browser. Every change is an *op*; `applyOp` is deterministic (dice are rolled client-side and travel inside the op). Also holds permissions (`canApply`) and player redaction. |
| Client | `public/js/` | Plain ES modules, no build step. `store.js` (state + pub/sub), `net.js` (API + WebSocket), `views/*` |

### Sync model
Clients apply their own ops optimistically and send them; the room validates
(`canApply`), applies, persists the touched sections, acks the sender and fans the op
out. Players receive a redacted stream (`playerMessages`): hidden tokens, hidden NPCs,
DM notes and fogged hexes never reach a player socket.

Players only get exact HP / AC / saves for player characters and tokens a player
controls; every other creature reaches them as a rough `health` state (unhurt, wounded,
bloodied, near death, down). Because of that, attacks carry only raw dice
(`resolveAction`) and the reducer decides hits and saves against the real numbers.
The DM's actions apply instantly; a player's actions round-trip through the room, which
answers with an animation-only copy of the op plus a redacted `patch` (tokens,
characters, combat, stats, new log entries). The log never records a monster's AC.

### Room gate
Create a room → 6-character code, DM password (required) and player password
(optional). Joining with the DM password grants DM; with the player password grants
player. Passwords are PBKDF2-SHA256 hashed; sessions are random tokens. Failed joins
are throttled (8 per minute per room).

## Features

**Battle map** — terrain / elevation / walls / feature painting, background image
upload with grid fitting, saved map library, PNG and JSON export, v1 JSON import.
BG3-style play: select a token, hover to preview a 5e-costed path (difficult terrain,
walls and enemies block), click to move (animated). The hotbar shows HP, AC, speed
left, action/bonus pips, spell slots and actions (hotkeys 1–9). Pick an action → range
box, attack bonus or save DC on hover, AoE circle for area spells → dice resolve and
animate for everyone (slash, arrow, spell orb, explosion, heal sparkles, floating
numbers, crits, shake). Initiative bar, rounds, dead combatants skipped, End Turn (E),
advantage/disadvantage, Dash, conditions, hidden tokens, Alt-click ping.

**Cover** (`core/cover.js`, DMG grid variant) — lines run from the attacker's best corner
to every corner of the target's space: 1–2 blocked → half cover (+2 AC / DEX saves),
3–4 → three-quarters (+5), all blocked by walls → total (can't be targeted). Walls and
closed doors block fully; obstacles cap at their own level (crate, barrel, table, low
wall → half and difficult terrain; boulder, pillar, tree, statue → three-quarters and
impassable); other creatures give half. Area effects measure cover from their origin
point. While aiming, targets show a ½ / ¾ / ✕ shield and a coloured line of sight,
and the tooltip notes the cover bonus. DMs can add `half cover` /
`three-quarters cover` conditions for cover the map doesn't show.

**Player rolls** (`ui/rollWindow.js`) — when a player confirms targets, a roll window
opens: roll to hit (two d20s with advantage/disadvantage), the room answers HIT / MISS /
CRITICAL without revealing AC (`check` message → `checkAttack`), then roll damage for
the hits (crits double the dice) and Strike. Save spells, auto-hit spells and heals are
a single damage/healing roll; targets' saves are rolled for them. The window can be
cancelled only before the first die is rolled. The DM's rolls stay instant.

**Action line format** (tokens, NPCs, manual characters):
`Name | melee/ranged/spell/save:dex/heal/auto | to-hit or DC | dice type | range ft | radius ft | flags`
with flags `bonus`, `slot:N`, `pact`, `targets:N`, `nohalf`.

**Hexcrawl** — flat/pointy hex grid, terrain + icon + label painting, per-hex public
and DM notes, map-image upload with size/offset/scale alignment, fog of war, party
marker travel (distance in hexes and miles, auto-reveal, logged to the adventure log),
day counter.

**Party** — import from D&D Beyond by character link (fetched through the room; the
sheet must be Public) or by uploading/pasting the v5 character JSON; re-sync keeps
live HP and conditions. Cards: HP (damage/heal/temp), AC, speed, initiative, passive
perception, ability scores, clickable spell & pact slots, conditions, death saves,
inspiration, short/long rest, player claiming.

**Journal** — adventure log (session recaps, notes, and automatic events: travel,
days, level-ups, deaths, NPCs met, encounters ended), searchable/filterable combat
log, encounter history (rounds, participants, damage dealt, kills, DM notes), NPC
registry (attitude, location, portrait, secrets, stat block, spawn on the map).

**Stats** — sessions, encounters, rounds, kills, downs, miles, days, dice rolled;
awards (Butcher, Biggest Hit, Field Medic, Grim Reaper, Sharpshooter, Blessed/Cursed
Dice, Nemesis…); leaderboards; a full numbers table; per-player dice luck.

**Dice tray** — build any pool; rolls broadcast to the table and feed the dice-luck
stats; the DM can roll secretly.
