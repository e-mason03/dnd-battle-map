// ============================================================
// Map data helpers
// ============================================================

function makeCell() {
  return { terrain: 'grass', elevation: 0, feature: null, token: null };
}

function initMap(w, h) {
  mapData.width = w;
  mapData.height = h;
  mapData.cells = [];
  for (let r = 0; r < h; r++) {
    mapData.cells[r] = [];
    for (let c = 0; c < w; c++) {
      mapData.cells[r][c] = makeCell();
    }
  }
}

function cloneMap() {
  return {
    width: mapData.width,
    height: mapData.height,
    cells: mapData.cells.map(row =>
      row.map(cell => ({ ...cell, token: cell.token ? { ...cell.token } : null }))
    ),
  };
}

function pushUndo() {
  undoStack.push(cloneMap());
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}
