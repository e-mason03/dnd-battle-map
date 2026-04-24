// ============================================================
// App logic — canvas events, toolbar actions, token modal,
// initiative tracker, dice, undo/redo, save/load, keyboard
// ============================================================

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
// Canvas events
// ============================================================

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
  if (!isValid(row, col)) return;
  pushUndo();
  const cell = mapData.cells[row][col];
  if (activeTab === 'terrain')        cell.terrain = 'grass';
  else if (activeTab === 'elevation') cell.elevation = 0;
  else if (activeTab === 'features')  cell.feature = null;
  else if (activeTab === 'tokens')    cell.token = null;
  else { cell.terrain = 'grass'; cell.elevation = 0; cell.feature = null; cell.token = null; }

  // FIX: sync context-menu changes to server
  sendWithSeq({ type: 'update_cell', row, col, cell });
  render();
});

canvas.addEventListener('mousedown', e => {
  if (e.button === 2) return;
  if (e.button === 1) {
    e.preventDefault();
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
    return;
  }
  if (isPanMode) {
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
  if (!isValid(row, col)) return;

  // Move mode — start drag
  if (isMoveMode) {
    if (mapData.cells[row][col].token) {
      draggingTokenFrom = { row, col };
    }
    return;
  }

  // Double-click opens token modal
  if (e.detail === 2 && mapData.cells[row][col].token) {
    openTokenModal(row, col);
    return;
  }

  pushUndo();
  isPainting = true;
  applyTool(row, col);
  render();
});

canvas.addEventListener('mousemove', e => {
  dragGhostEl.style.left = e.clientX + 'px';
  dragGhostEl.style.top = e.clientY + 'px';

  if (isPanning && panStart) {
    camera.x = panStart.cx + (e.clientX - panStart.x);
    camera.y = panStart.cy + (e.clientY - panStart.y);
    render();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const { row, col } = canvasToCell(mx, my);

  if (isValid(row, col)) {
    document.getElementById('coordDisplay').textContent = `${colLabel(col)}${row + 1}`;
  } else {
    document.getElementById('coordDisplay').textContent = '\u2014';
  }

  if (isPainting && isValid(row, col)) {
    applyTool(row, col);
    render();
  }

  if (draggingTokenFrom && isValid(row, col)) {
    render();
    const s = cs();
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(col * s + camera.x + 1, row * s + camera.y + 1, s - 2, s - 2);
  }
});

canvas.addEventListener('mouseup', e => {
  // End panning
  if (isPanning) {
    isPanning = false;
    panStart = null;
    return;
  }

  // Handle token drag movement
  if (draggingTokenFrom) {
    const rect = canvas.getBoundingClientRect();
    const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);

    if (
      isValid(row, col) &&
      (row !== draggingTokenFrom.row || col !== draggingTokenFrom.col)
    ) {
      if (!mapData.cells[row][col].token) {
        pushUndo();

        // FIX: apply the move locally so the sender sees it immediately
        mapData.cells[row][col].token =
          mapData.cells[draggingTokenFrom.row][draggingTokenFrom.col].token;
        mapData.cells[draggingTokenFrom.row][draggingTokenFrom.col].token = null;

        sendWithSeq({
          type: 'move_token',
          from: draggingTokenFrom,
          to: { row, col },
        });

        render();
        setTimeout(renderInitList, 50);
      }
    }

    draggingTokenFrom = null;
    return;
  }

  // Stop painting
  isPainting = false;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const oldZ = zoom;
  zoom = Math.max(0.15, Math.min(4.0, zoom + (e.deltaY > 0 ? -0.08 : 0.08)));
  const sc = zoom / oldZ;
  camera.x = mx - sc * (mx - camera.x);
  camera.y = my - sc * (my - camera.y);
  document.getElementById('zoomSlider').value = zoom;
  render();
}, { passive: false });

canvas.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvas.addEventListener('drop', e => {
  e.preventDefault();
  if (!dragCanvasToken) return;
  const rect = canvas.getBoundingClientRect();
  const { row, col } = canvasToCell(e.clientX - rect.left, e.clientY - rect.top);
  if (!isValid(row, col) || mapData.cells[row][col].token) return;
  pushUndo();
  mapData.cells[row][col].token = {
    type: dragCanvasToken.type,
    name: dragCanvasToken.label,
    hp: 10,
    maxHp: 10,
    isPlayer: dragCanvasToken.isPlayer,
    initiative: 0,
  };

  // FIX: sync drag-from-sidebar token placement to server
  sendWithSeq({
    type: 'update_cell',
    row,
    col,
    cell: mapData.cells[row][col],
  });

  render();
  isDraggingFromSidebar = false;
  dragCanvasToken = null;
  dragGhostEl.style.display = 'none';
});

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

// ============================================================
// Initiative Tracker
// ============================================================

function toggleInitTracker() {
  initTrackerOpen = !initTrackerOpen;
  document.getElementById('initTracker').classList.toggle('open', initTrackerOpen);
  document.getElementById('initToggleBtn').style.display = initTrackerOpen ? 'none' : 'flex';
  if (initTrackerOpen) renderInitList();
}

function getTokensWithInit() {
  const tokens = [];
  for (let r = 0; r < mapData.height; r++) {
    for (let c = 0; c < mapData.width; c++) {
      const cell = mapData.cells[r]?.[c];
      if (cell?.token && cell.token.initiative > 0) {
        tokens.push({ ...cell.token, row: r, col: c });
      }
    }
  }
  return tokens.sort((a, b) => b.initiative - a.initiative);
}

function renderInitList() {
  const list = document.getElementById('initList');
  const tokens = getTokensWithInit();
  list.innerHTML = '';

  if (tokens.length === 0) {
    list.innerHTML =
      '<div style="padding:12px;color:var(--text2);font-size:11px;text-align:center">No tokens with initiative.<br>Edit a token to set initiative.</div>';
    return;
  }

  if (currentTurn >= tokens.length) currentTurn = 0;

  tokens.forEach((tok, i) => {
    const tDef = ALL_TOKENS.find(t => t.type === tok.type) || ALL_TOKENS[0];
    const div = document.createElement('div');
    div.className = 'init-row' + (i === currentTurn ? ' current' : '');
    div.innerHTML = `
      <div class="init-avatar" style="background:${tDef.color}">${tDef.abbr || tok.name?.[0] || '?'}</div>
      <div class="init-name">${tok.name || tok.type}</div>
      <div class="init-hp">${tok.hp}/${tok.maxHp}</div>
    `;
    list.appendChild(div);
  });
}

function initNext() {
  const tokens = getTokensWithInit();
  if (tokens.length === 0) return;
  currentTurn = (currentTurn + 1) % tokens.length;
  renderInitList();
}

function initPrev() {
  const tokens = getTokensWithInit();
  if (tokens.length === 0) return;
  currentTurn = (currentTurn - 1 + tokens.length) % tokens.length;
  renderInitList();
}

// ============================================================
// Dice roller
// ============================================================

function rollDice() {
  const count = Math.min(10, Math.max(1, parseInt(document.getElementById('diceCount').value) || 1));
  const sides = parseInt(document.getElementById('diceType').value);

  // Pre-generate deterministic results
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }

  // Send over WebSocket — the DO broadcasts to ALL clients (including sender)
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'roll_dice', count, sides, results }));
  } else {
    // Offline fallback
    showDiceRoll(count, sides, results);
  }
}

function showDiceRoll(count, sides, results) {
  const display = document.getElementById('diceDisplay');
  const resultModal = document.getElementById('diceResult');

  display.innerHTML = '';
  resultModal.classList.remove('open');

  const duration = 1100;
  let completed = 0;

  for (let i = 0; i < count; i++) {
    const dieEl = document.createElement('div');
    dieEl.className = 'die rolling';
    dieEl.dataset.sides = sides;
    dieEl.textContent = '?';
    display.appendChild(dieEl);

    const final = results[i];
    const startTime = Date.now();
    const interval = setInterval(() => {
      dieEl.textContent = Math.floor(Math.random() * sides) + 1;

      if (Date.now() - startTime >= duration) {
        clearInterval(interval);
        dieEl.textContent = final;
        dieEl.classList.remove('rolling');

        if (final === sides) dieEl.classList.add('nat20');
        else if (final === 1) dieEl.classList.add('nat1');

        completed++;

        if (completed === count) {
          const total = results.reduce((a, b) => a + b, 0);
          document.getElementById('diceTotal').textContent = total;
          document.getElementById('diceBreakdown').textContent =
            count > 1 ? `${results.join(' + ')} = ${total}` : '';
          resultModal.classList.add('open');
          setTimeout(() => resultModal.classList.remove('open'), 2200);
        }
      }
    }, 45);
  }
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
// Save / Load / Export
// ============================================================

function saveMap() {
  try {
    localStorage.setItem('dnd-combat-map-v2', JSON.stringify(mapData));
    showToast('\u2714 Map saved to browser storage');
  } catch (e) {
    showToast('Save failed: ' + e.message, true);
  }
}

function loadMap() {
  try {
    const raw = localStorage.getItem('dnd-combat-map-v2');
    if (!raw) {
      showToast('No saved map found.', true);
      return;
    }
    pushUndo();
    mapData = JSON.parse(raw);
    document.getElementById('mapW').value = mapData.width;
    document.getElementById('mapH').value = mapData.height;
    render();
    showToast('\u2714 Map loaded');
  } catch (e) {
    showToast('Load failed: ' + e.message, true);
  }
}

function exportPNG() {
  const s = baseCellSize;
  const ow = mapData.width * s, oh = mapData.height * s;
  const off = document.createElement('canvas');
  off.width = ow;
  off.height = oh;
  const oc = off.getContext('2d');

  oc.fillStyle = '#07070e';
  oc.fillRect(0, 0, ow, oh);

  for (let r = 0; r < mapData.height; r++) {
    for (let c = 0; c < mapData.width; c++) {
      const cell = mapData.cells[r][c];
      const px = c * s, py = r * s;
      const terr = TERRAINS[cell.terrain] || TERRAINS.grass;
      oc.fillStyle = terr.color;
      oc.fillRect(px, py, s, s);

      if (cell.feature && FEATURES[cell.feature]) {
        oc.fillStyle = FEATURES[cell.feature].color;
        oc.fillRect(px, py, s, s);
      }
      if (cell.elevation > 0) {
        const elev = ELEVATIONS[cell.elevation];
        if (elev) {
          if (elev.isWall) {
            oc.fillStyle = '#111';
            oc.fillRect(px, py, s, s);
          } else if (elev.bw > 0) {
            oc.strokeStyle = elev.bc;
            oc.lineWidth = elev.bw;
            oc.strokeRect(px + elev.bw / 2, py + elev.bw / 2, s - elev.bw, s - elev.bw);
          }
        }
      }
      if (cell.token) {
        const tDef = ALL_TOKENS.find(t => t.type === cell.token.type) || ALL_TOKENS[0];
        const rad = s * 0.41, tcx = px + s / 2, tcy = py + s / 2;
        oc.fillStyle = tDef.color;
        oc.beginPath();
        oc.arc(tcx, tcy, rad, 0, Math.PI * 2);
        oc.fill();
        oc.strokeStyle = cell.token.isPlayer ? '#6ab4f5' : '#f58080';
        oc.lineWidth = 2;
        oc.beginPath();
        oc.arc(tcx, tcy, rad, 0, Math.PI * 2);
        oc.stroke();
        oc.fillStyle = '#fff';
        oc.font = `bold ${s * 0.27}px sans-serif`;
        oc.textAlign = 'center';
        oc.textBaseline = 'middle';
        oc.fillText(tDef.abbr, tcx, tcy);
      }
    }
  }

  oc.strokeStyle = 'rgba(255,255,255,0.15)';
  oc.lineWidth = 1;
  oc.beginPath();
  for (let c = 0; c <= mapData.width; c++) {
    oc.moveTo(c * s + 0.5, 0);
    oc.lineTo(c * s + 0.5, oh);
  }
  for (let r = 0; r <= mapData.height; r++) {
    oc.moveTo(0, r * s + 0.5);
    oc.lineTo(ow, r * s + 0.5);
  }
  oc.stroke();

  const a = document.createElement('a');
  a.download = 'combat-map.png';
  a.href = off.toDataURL('image/png');
  a.click();
  showToast('\u2714 Map exported as PNG');
}

// ============================================================
// Token modal
// ============================================================

function openTokenModal(row, col) {
  editingTokenPos = { row, col };
  const tok = mapData.cells[row][col].token;
  const tDef = ALL_TOKENS.find(t => t.type === tok.type);
  document.getElementById('modalTitle').textContent = `Edit ${tDef?.label || tok.type}`;
  document.getElementById('tokenNameInput').value = tok.name || '';
  document.getElementById('tokenHpInput').value = tok.hp ?? 10;
  document.getElementById('tokenMaxHpInput').value = tok.maxHp ?? 10;
  document.getElementById('tokenInitInput').value = tok.initiative ?? 0;
  document.getElementById('tokenModal').classList.add('open');
}

function closeModal() {
  document.getElementById('tokenModal').classList.remove('open');
  editingTokenPos = null;
}

function saveToken() {
  if (!editingTokenPos) return;
  const { row, col } = editingTokenPos;
  const tok = mapData.cells[row][col].token;
  if (!tok) return;

  pushUndo();
  tok.name = document.getElementById('tokenNameInput').value;
  tok.hp = parseInt(document.getElementById('tokenHpInput').value) || 0;
  tok.maxHp = parseInt(document.getElementById('tokenMaxHpInput').value) || 10;
  tok.initiative = parseInt(document.getElementById('tokenInitInput').value) || 0;

  sendWithSeq({ type: 'update_cell', row, col, cell: mapData.cells[row][col] });

  closeModal();
  render();
}

function deleteToken() {
  if (!editingTokenPos) return;
  const { row, col } = editingTokenPos;
  pushUndo();
  mapData.cells[row][col].token = null;
  sendWithSeq({ type: 'update_cell', row, col, cell: mapData.cells[row][col] });
  closeModal();
  render();
}

document.getElementById('tokenModal').addEventListener('click', e => {
  if (e.target === document.getElementById('tokenModal')) closeModal();
});

// ============================================================
// Boot
// ============================================================

initMap(20, 20);
buildUI();
resizeCanvas();
selectTerrain('grass');

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

// Keyboard shortcuts
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
