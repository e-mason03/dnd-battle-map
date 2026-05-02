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