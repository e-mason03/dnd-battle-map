// ============================================================
// UI building + tool selection + sidebar
// ============================================================

const dragGhostEl = document.getElementById('dragGhost');

function buildUI() {
  // Terrain
  const tg = document.getElementById('terrainGrid');
  tg.innerHTML = '';
  for (const [key, t] of Object.entries(TERRAINS)) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn' + (key === 'grass' ? ' selected' : '');
    btn.id = 'tbtn-' + key;
    btn.innerHTML = `<div class="terrain-swatch" style="background:${t.color}"></div><span>${t.label}</span>`;
    btn.onclick = () => selectTerrain(key);
    tg.appendChild(btn);
  }

  // Elevation
  const eg = document.getElementById('elevGrid');
  eg.innerHTML = '';
  ELEVATIONS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.id = 'ebtn-' + e.level;
    const borderStyle = e.bw > 0 ? `${e.bw}px solid ${e.bc}` : '1px solid #333';
    const bg = e.isWall ? '#111' : '#3d6b47';
    btn.innerHTML = `<div class="elev-preview" style="background:${bg};border:${borderStyle}">${e.marker || ''}</div><span>${e.label}</span>`;
    btn.onclick = () => selectElevation(e.level);
    eg.appendChild(btn);
  });

  // Features
  const fg = document.getElementById('featuresGrid');
  fg.innerHTML = '';
  for (const [key, f] of Object.entries(FEATURES)) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.id = 'fbtn-' + key;
    btn.innerHTML = `<div style="font-size:15px;line-height:1.1">${f.icon}</div><span>${f.label}</span>`;
    btn.onclick = () => selectFeature(key);
    fg.appendChild(btn);
  }

  buildTokenList('');
}

function buildTokenList(filter) {
  const list = document.getElementById('tokenList');
  list.innerHTML = '';
  const f = filter.toLowerCase();
  const pl = PLAYER_TOKENS.filter(t => !f || t.label.toLowerCase().includes(f));
  const mn = MONSTER_TOKENS.filter(t => !f || t.label.toLowerCase().includes(f));

  if (pl.length) {
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = 'Players';
    list.appendChild(h);
    pl.forEach(t => list.appendChild(makeTokenItem(t)));
  }
  if (mn.length) {
    const h = document.createElement('div');
    h.className = 'section-title';
    h.style.marginTop = '10px';
    h.textContent = 'Monsters';
    list.appendChild(h);
    mn.forEach(t => list.appendChild(makeTokenItem(t)));
  }
}

function makeTokenItem(t) {
  const item = document.createElement('div');
  item.className = 'token-item';
  item.draggable = true;
  item.dataset.tokenType = t.type;
  item.innerHTML = `
    <div class="token-circle" style="background:${t.color}">${t.abbr}</div>
    <div>
      <div class="token-name">${t.label}</div>
      <div class="token-type">${t.isPlayer ? 'Player' : 'Monster'}</div>
    </div>`;

  item.addEventListener('dragstart', e => {
    isDraggingFromSidebar = true;
    dragCanvasToken = t;
    dragGhostEl.style.background = t.color;
    dragGhostEl.textContent = t.abbr;
    dragGhostEl.style.display = 'flex';
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = document.createElement('div');
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
  });
  item.addEventListener('dragend', () => {
    isDraggingFromSidebar = false;
    dragCanvasToken = null;
    dragGhostEl.style.display = 'none';
  });
  item.addEventListener('click', () => {
    document.querySelectorAll('.token-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    activeTool = { category: 'token', value: t.type };
    updateToolDisplay();
  });
  return item;
}

// ============================================================
// Tool selection
// ============================================================

function selectTerrain(key) {
  activeTool = { category: 'terrain', value: key };
  document.querySelectorAll('#terrainGrid .tool-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('tbtn-' + key)?.classList.add('selected');
  updateToolDisplay();
}

function selectElevation(level) {
  activeTool = { category: 'elevation', value: level };
  document.querySelectorAll('#elevGrid .tool-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('ebtn-' + level)?.classList.add('selected');
  updateToolDisplay();
}

function selectFeature(key) {
  activeTool = { category: 'feature', value: key };
  document.querySelectorAll('#featuresGrid .tool-btn').forEach(b => b.classList.remove('selected'));
  if (key) document.getElementById('fbtn-' + key)?.classList.add('selected');
  updateToolDisplay();
}

function updateToolDisplay() {
  let name = '';
  if (activeTool.category === 'terrain') name = TERRAINS[activeTool.value]?.label || activeTool.value;
  else if (activeTool.category === 'elevation') name = ELEVATIONS[activeTool.value]?.label || String(activeTool.value);
  else if (activeTool.category === 'feature') name = activeTool.value ? (FEATURES[activeTool.value]?.label || activeTool.value) : 'Erase Feature';
  else if (activeTool.category === 'token') name = ALL_TOKENS.find(t => t.type === activeTool.value)?.label || activeTool.value;
  document.getElementById('toolDisplay').textContent = 'Tool: ' + name;
}

// ============================================================
// Tab switching
// ============================================================

function switchTab(name, btn) {
  activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

function filterTokens(v) { buildTokenList(v); }

// ============================================================
// Toast notification
// ============================================================

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);
    background:${isError ? '#7b241c' : '#1a5c38'};color:#fff;padding:8px 18px;
    border-radius:5px;font-size:12px;font-family:'Fira Sans',sans-serif;
    z-index:200;pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,0.6);
    animation:fadeout 2.2s forwards;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2300);
}
