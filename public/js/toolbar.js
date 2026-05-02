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
// Toolbar actions
// ============================================================

function newMap() {
  if (!confirm('Create a new map? Unsaved changes will be lost.')) return;
  const w = parseInt(document.getElementById('mapW').value) || 20;
  const h = parseInt(document.getElementById('mapH').value) || 20;
  initMap(w, h);
  undoStack = [];
  redoStack = [];
  camera = { x: 0, y: 0 };
  zoom = 1;
  document.getElementById('zoomSlider').value = 1;
  centerMap();
  render();
  sendWithSeq({ type: 'set_map', state: mapData });
}

function clearMap() {
  if (!confirm('Clear all terrain, features, and tokens?')) return;
  for (let r = 0; r < mapData.height; r++) {
    for (let c = 0; c < mapData.width; c++) {
      mapData.cells[r][c] = makeCell();
    }
  }
  render();
  sendWithSeq({ type: 'set_map', state: mapData });
}

function resizeMap() {
  const w = parseInt(document.getElementById('mapW').value) || 20;
  const h = parseInt(document.getElementById('mapH').value) || 20;
  pushUndo();
  const nc = [];
  for (let r = 0; r < h; r++) {
    nc[r] = [];
    for (let c = 0; c < w; c++) {
      nc[r][c] =
        mapData.cells[r] && mapData.cells[r][c]
          ? { ...mapData.cells[r][c], token: mapData.cells[r][c].token ? { ...mapData.cells[r][c].token } : null }
          : makeCell();
    }
  }
  mapData.width = w;
  mapData.height = h;
  mapData.cells = nc;
  render();
  // FIX: sync resize to server
  sendWithSeq({ type: 'set_map', state: mapData });
}

function setZoom(v) {
  zoom = v;
  render();
}

function togglePan() {
  isPanMode = !isPanMode;
  if (isPanMode) isMoveMode = false;
  isPlaceMode = !isPanMode && !isMoveMode;
  document.getElementById('panBtn').classList.toggle('active', isPanMode);
  document.getElementById('moveBtn').classList.toggle('active', isMoveMode);
  document.getElementById('placeBtn').classList.toggle('active', isPlaceMode);
  wrap.className = 'canvas-wrap' + (isPanMode ? ' pan-mode' : '') + (isMoveMode ? ' move-mode' : '');
  document.getElementById('modeDisplay').textContent = isPanMode ? 'Pan Mode' : isMoveMode ? 'Move Mode' : 'Place Mode';
}

function toggleMove() {
  isMoveMode = !isMoveMode;
  if (isMoveMode) isPanMode = false;
  isPlaceMode = !isPanMode && !isMoveMode;
  document.getElementById('panBtn').classList.toggle('active', isPanMode);
  document.getElementById('moveBtn').classList.toggle('active', isMoveMode);
  document.getElementById('placeBtn').classList.toggle('active', isPlaceMode);
  wrap.className = 'canvas-wrap' + (isPanMode ? ' pan-mode' : '') + (isMoveMode ? ' move-mode' : '');
  document.getElementById('modeDisplay').textContent = isMoveMode ? 'Move Mode' : 'Place Mode';
}

function togglePlace() {
  isPlaceMode = !isPlaceMode;
  if (isPlaceMode) {
    isPanMode = false;
    isMoveMode = false;
  }
  document.getElementById('panBtn').classList.toggle('active', isPanMode);
  document.getElementById('moveBtn').classList.toggle('active', isMoveMode);
  document.getElementById('placeBtn').classList.toggle('active', isPlaceMode);
  wrap.className = 'canvas-wrap' + (isPanMode ? ' pan-mode' : '') + (isMoveMode ? ' move-mode' : '');
  document.getElementById('modeDisplay').textContent = isPlaceMode ? 'Place Mode' : 'No Mode Selected';
}

function updateGridColor(hex) {
  gridColorHex = hex;
  render();
}
function updateCellSize(v) {
  baseCellSize = Math.max(20, Math.min(80, v));
  render();
}