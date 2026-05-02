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