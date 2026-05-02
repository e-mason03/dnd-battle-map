// ============================================================
// Imports
// ============================================================

import { registerCanvasEvents } from './canvasEvents.js';
import { newMap, clearMap, resizeMap, setZoom, togglePan, toggleMove, togglePlace, updateGridColor, updateCellSize } from './toolbar.js';
import { saveMap, loadMap, exportPNG } from './saveLoad.js';
import { toggleInitTracker, renderInitList, initNext, initPrev } from './initiativeTracker.js';
import { rollDice, showDiceRoll } from './diceRoller.js';
import { openTokenModal, closeModal, saveToken, deleteToken, registerTokenModalEvents } from './tokenModal.js';

// ============================================================
// Tool application — mutates mapData AND syncs to server
// ============================================================

function applyTool(row, col) {
  const cell = mapData.cells[row][col];

  if (activeTool.category === 'terrain') {
    cell.terrain = activeTool.value;
  } else if (activeTool.category === 'elevation') {
    cell.elevation = activeTool.value;
  } else if (activeTool.category === 'feature') {
    cell.feature = activeTool.value;
  } else if (activeTool.category === 'token') {
    if (!cell.token) {
      const tDef = ALL_TOKENS.find(t => t.type === activeTool.value);
      cell.token = {
        type: activeTool.value,
        name: tDef?.label || activeTool.value,
        hp: 10,
        maxHp: 10,
        isPlayer: tDef?.isPlayer || false,
        initiative: 0,
      };
    }
  }

  // Sync to server
  sendWithSeq({ type: 'update_cell', row, col, cell });
}

// ============================================================
// Undo / Redo
// ============================================================

function undo() {
  if (!undoStack.length) return;
  redoStack.push(cloneMap());
  mapData = undoStack.pop();
  document.getElementById('mapW').value = mapData.width;
  document.getElementById('mapH').value = mapData.height;
  render();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(cloneMap());
  mapData = redoStack.pop();
  render();
}

// ============================================================
// Boot
// ============================================================

initMap(20, 20);
buildUI();
resizeCanvas();
selectTerrain('grass');

registerCanvasEvents(canvas, { applyTool, pushUndo, openTokenModal, render, renderInitList, sendWithSeq });
registerTokenModalEvents();

window.addEventListener('resize', resizeCanvas);

setTimeout(() => {
  centerMap();
  render();
}, 60);

// Auto-save every 90s
setInterval(() => {
  try {
    localStorage.setItem('dnd-combat-map-v2', JSON.stringify(mapData));
  } catch (e) {
    // silently ignore
  }
}, 90000);

// ============================================================
// Keyboard shortcuts
// ============================================================

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    e.preventDefault();
    redo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveMap();
  }
  if (e.key === ' ') {
    e.preventDefault();
    if (!isPanMode && !isMoveMode) {
      togglePan();
    } else if (isPanMode) {
      togglePan();
      toggleMove();
    } else {
      toggleMove();
    }
  }
  if (e.key === '=' || e.key === '+') {
    zoom = Math.min(4, zoom + 0.1);
    document.getElementById('zoomSlider').value = zoom;
    render();
  }
  if (e.key === '-') {
    zoom = Math.max(0.15, zoom - 0.1);
    document.getElementById('zoomSlider').value = zoom;
    render();
  }
});