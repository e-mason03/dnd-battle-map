// ============================================================
// Canvas rendering
// ============================================================

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');

function resizeCanvas() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  render();
}

// ============================================================
// Coordinate helpers
// ============================================================

function cs() { return baseCellSize * zoom; }

function canvasToCell(mx, my) {
  const s = cs();
  return {
    row: Math.floor((my - camera.y) / s),
    col: Math.floor((mx - camera.x) / s),
  };
}

function isValid(r, c) {
  return r >= 0 && r < mapData.height && c >= 0 && c < mapData.width;
}

function colLabel(col) {
  let lbl = '';
  let n = col;
  do {
    lbl = String.fromCharCode(65 + (n % 26)) + lbl;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return lbl;
}

function hexToRgb(hex) {
  return `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
}

function centerMap() {
  const s = cs();
  camera.x = (canvas.width - mapData.width * s) / 2;
  camera.y = (canvas.height - mapData.height * s) / 2;
}

// ============================================================
// Main render
// ============================================================

function render() {
  const W = canvas.width, H = canvas.height;
  const s = cs();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#07070e';
  ctx.fillRect(0, 0, W, H);

  const sc = Math.max(0, Math.floor(-camera.x / s));
  const ec = Math.min(mapData.width, Math.ceil((W - camera.x) / s));
  const sr = Math.max(0, Math.floor(-camera.y / s));
  const er = Math.min(mapData.height, Math.ceil((H - camera.y) / s));

  for (let r = sr; r < er; r++) {
    for (let c = sc; c < ec; c++) {
      drawCell(r, c);
    }
  }

  // Grid lines
  const rgb = hexToRgb(gridColorHex);
  ctx.strokeStyle = `rgba(${rgb},${gridAlpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = sc; c <= ec; c++) {
    const x = c * s + camera.x + 0.5;
    ctx.moveTo(x, sr * s + camera.y);
    ctx.lineTo(x, er * s + camera.y);
  }
  for (let r = sr; r <= er; r++) {
    const y = r * s + camera.y + 0.5;
    ctx.moveTo(sc * s + camera.x, y);
    ctx.lineTo(ec * s + camera.x, y);
  }
  ctx.stroke();

  // Coord labels
  const showC = document.getElementById('showCoords').checked;
  if (showC && s >= 22) {
    const fs = Math.max(8, Math.min(11, s * 0.22));
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `${fs}px "Fira Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = sr; r < er; r++) {
      for (let c = sc; c < ec; c++) {
        ctx.fillText(`${colLabel(c)}${r + 1}`, c * s + camera.x + s * 0.5, r * s + camera.y + s * 0.87);
      }
    }
  }

  document.getElementById('zoomDisplay').textContent = `Zoom: ${Math.round(zoom * 100)}%`;
}

// ============================================================
// Cell drawing
// ============================================================

function drawCell(r, c) {
  const cell = mapData.cells[r][c];
  const s = cs();
  const px = c * s + camera.x, py = r * s + camera.y;

  // Terrain base
  const terr = TERRAINS[cell.terrain] || TERRAINS.grass;
  ctx.fillStyle = terr.color;
  ctx.fillRect(px, py, s, s);

  // Terrain pattern
  drawTerrainPattern(cell.terrain, px, py, s);

  // Feature overlay
  if (cell.feature && FEATURES[cell.feature]) {
    ctx.fillStyle = FEATURES[cell.feature].color;
    ctx.fillRect(px, py, s, s);
    if (s >= 18) drawFeatureDetail(cell.feature, px, py, s);
  }

  // Elevation
  if (cell.elevation > 0) {
    const elev = ELEVATIONS[cell.elevation];
    if (elev) {
      if (elev.isWall) {
        drawWall(px, py, s);
      } else if (elev.bw > 0) {
        ctx.strokeStyle = elev.bc;
        ctx.lineWidth = elev.bw;
        ctx.strokeRect(px + elev.bw / 2, py + elev.bw / 2, s - elev.bw, s - elev.bw);
        if (elev.marker && s >= 16) {
          ctx.fillStyle = elev.bc;
          ctx.font = `${Math.max(10, s * 0.28)}px sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(elev.marker, px + 3, py + 2);
        }
      }
    }
  }

  // Token
  if (cell.token) drawTokenCircle(cell.token, px, py, s);
}

// ============================================================
// Terrain patterns
// ============================================================

function drawTerrainPattern(terrain, px, py, s) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, s, s);
  ctx.clip();

  switch (terrain) {
    case 'grass':
      ctx.strokeStyle = 'rgba(80,180,60,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const bx = px + (i + 0.5) * s / 5;
        ctx.beginPath();
        ctx.moveTo(bx, py + s * 0.78);
        ctx.lineTo(bx - s * 0.04, py + s * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx, py + s * 0.78);
        ctx.lineTo(bx + s * 0.04, py + s * 0.5);
        ctx.stroke();
      }
      break;
    case 'stone':
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + s * 0.25, py + s * 0.15);
      ctx.lineTo(px + s * 0.55, py + s * 0.45);
      ctx.lineTo(px + s * 0.45, py + s * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + s * 0.7, py + s * 0.2);
      ctx.lineTo(px + s * 0.55, py + s * 0.5);
      ctx.stroke();
      break;
    case 'water':
      ctx.strokeStyle = 'rgba(80,170,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const wy = py + s * (0.2 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(px, wy);
        ctx.quadraticCurveTo(px + s * 0.25, wy - s * 0.05, px + s * 0.5, wy);
        ctx.quadraticCurveTo(px + s * 0.75, wy + s * 0.05, px + s, wy);
        ctx.stroke();
      }
      break;
    case 'lava':
      ctx.strokeStyle = 'rgba(255,180,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + s * 0.15, py + s * 0.9);
      ctx.lineTo(px + s * 0.3, py + s * 0.4);
      ctx.lineTo(px + s * 0.5, py + s * 0.65);
      ctx.lineTo(px + s * 0.65, py + s * 0.15);
      ctx.lineTo(px + s * 0.8, py + s * 0.5);
      ctx.lineTo(px + s * 0.9, py + s * 0.9);
      ctx.stroke();
      break;
    case 'snow':
      ctx.strokeStyle = 'rgba(180,210,255,0.5)';
      ctx.lineWidth = 1;
      const scx = px + s / 2, scy = py + s / 2, sr2 = s * 0.22;
      for (let a = 0; a < 6; a++) {
        const ang = a * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(scx, scy);
        ctx.lineTo(scx + Math.cos(ang) * sr2, scy + Math.sin(ang) * sr2);
        ctx.stroke();
      }
      break;
    case 'dirt':
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(px + ((i * 53 + 7) % s), py + ((i * 37 + 13) % s), 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'sand':
      ctx.fillStyle = 'rgba(160,110,30,0.2)';
      for (let i = 0; i < 9; i++) ctx.fillRect(px + ((i * 41 + 3) % s), py + ((i * 19 + 9) % s), 2, 1);
      break;
    case 'void':
      ctx.fillStyle = 'rgba(180,180,255,0.3)';
      for (let i = 0; i < 4; i++) ctx.fillRect(px + ((i * 47 + 5) % (s - 1)), py + ((i * 31 + 11) % (s - 1)), 1, 1);
      break;
  }
  ctx.restore();
}

// ============================================================
// Feature detail drawing
// ============================================================

function drawFeatureDetail(key, px, py, s) {
  const cx = px + s / 2, cy = py + s / 2;
  switch (key) {
    case 'fire':
      ctx.fillStyle = 'rgba(255,90,0,0.85)';
      ctx.beginPath();
      ctx.moveTo(cx, py + s * 0.18);
      ctx.bezierCurveTo(cx + s * 0.28, py + s * 0.38, cx + s * 0.22, py + s * 0.65, cx, py + s * 0.85);
      ctx.bezierCurveTo(cx - s * 0.22, py + s * 0.65, cx - s * 0.28, py + s * 0.38, cx, py + s * 0.18);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,210,30,0.8)';
      ctx.beginPath();
      ctx.moveTo(cx, py + s * 0.33);
      ctx.bezierCurveTo(cx + s * 0.14, py + s * 0.48, cx + s * 0.1, py + s * 0.68, cx, py + s * 0.82);
      ctx.bezierCurveTo(cx - s * 0.1, py + s * 0.68, cx - s * 0.14, py + s * 0.48, cx, py + s * 0.33);
      ctx.fill();
      break;
    case 'web':
      ctx.strokeStyle = 'rgba(230,230,230,0.7)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42);
        ctx.stroke();
      }
      for (let rr = 0.12; rr <= 0.42; rr += 0.13) {
        ctx.beginPath();
        ctx.arc(cx, cy, s * rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'trap':
      ctx.strokeStyle = 'rgba(255,50,50,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + s * 0.25, py + s * 0.25);
      ctx.lineTo(px + s * 0.75, py + s * 0.75);
      ctx.moveTo(px + s * 0.75, py + s * 0.25);
      ctx.lineTo(px + s * 0.25, py + s * 0.75);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,50,50,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'spike':
      ctx.fillStyle = 'rgba(170,170,170,0.85)';
      for (let i = 0; i < 3; i++) {
        const bx = px + s * (0.18 + i * 0.28);
        ctx.beginPath();
        ctx.moveTo(bx, py + s * 0.88);
        ctx.lineTo(bx + s * 0.1, py + s * 0.88);
        ctx.lineTo(bx + s * 0.05, py + s * 0.18);
        ctx.fill();
      }
      break;
    case 'light':
      ctx.strokeStyle = 'rgba(255,230,70,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * s * 0.2, cy + Math.sin(a) * s * 0.2);
        ctx.lineTo(cx + Math.cos(a) * s * 0.38, cy + Math.sin(a) * s * 0.38);
        ctx.stroke();
      }
      break;
    case 'fog':
      ctx.fillStyle = 'rgba(210,210,225,0.55)';
      [[-0.2, 0.05], [0, -0.06], [0.2, 0.03]].forEach(([ox, oy]) => {
        ctx.beginPath();
        ctx.arc(cx + ox * s, cy + oy * s, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    case 'pool':
    case 'stream':
      ctx.strokeStyle = 'rgba(80,170,255,0.75)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const wy = py + s * (0.25 + i * 0.22);
        ctx.beginPath();
        ctx.moveTo(px + s * 0.1, wy);
        ctx.quadraticCurveTo(cx, wy - s * 0.07, px + s * 0.9, wy);
        ctx.stroke();
      }
      break;
    case 'ravine':
      ctx.strokeStyle = 'rgba(5,2,1,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + s * 0.28, py);
      ctx.lineTo(px + s * 0.35, py + s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + s * 0.62, py);
      ctx.lineTo(px + s * 0.68, py + s);
      ctx.stroke();
      break;
    case 'darkness':
      ctx.fillStyle = 'rgba(0,0,8,0.5)';
      ctx.fillRect(px, py, s, s);
      break;
  }
}

// ============================================================
// Wall drawing
// ============================================================

function drawWall(px, py, s) {
  ctx.fillStyle = '#111';
  ctx.fillRect(px, py, s, s);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 3;
  ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
  const bh = s / 3;
  ctx.strokeStyle = 'rgba(70,70,70,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(px, py + i * bh);
    ctx.lineTo(px + s, py + i * bh);
    ctx.stroke();
    const off = (i % 2) * s / 2;
    ctx.beginPath();
    ctx.moveTo(px + off, py + i * bh);
    ctx.lineTo(px + off, py + (i + 1) * bh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + off + s / 2, py + i * bh);
    ctx.lineTo(px + off + s / 2, py + (i + 1) * bh);
    ctx.stroke();
  }
}

// ============================================================
// Token circle drawing
// ============================================================

function drawTokenCircle(token, px, py, s) {
  const tDef = ALL_TOKENS.find(t => t.type === token.type) || ALL_TOKENS[0];
  const rad = s * 0.41;
  const tcx = px + s / 2, tcy = py + s / 2;

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 7;

  // Outer ring
  ctx.strokeStyle = token.isPlayer ? '#6ab4f5' : '#f58080';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(tcx, tcy, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Fill
  ctx.fillStyle = tDef.color;
  ctx.beginPath();
  ctx.arc(tcx, tcy, rad - 1, 0, Math.PI * 2);
  ctx.fill();

  // Inner highlight
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.arc(tcx - rad * 0.2, tcy - rad * 0.25, rad * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Abbreviation
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(8, s * 0.27)}px "Fira Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tDef.abbr, tcx, tcy);

  // Name label
  if (token.name && s >= 32) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.max(7, s * 0.17)}px "Fira Sans", sans-serif`;
    ctx.fillText(token.name.substring(0, 7), tcx, py + s * 0.92);
  }

  // HP bar
  if (token.maxHp > 0 && s >= 24) {
    const bw = s * 0.7, bh = Math.max(3, s * 0.07);
    const bx = px + (s - bw) / 2, by = py + s * 0.05;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, bw, bh);
    const pct = Math.max(0, Math.min(1, token.hp / token.maxHp));
    ctx.fillStyle = pct > 0.6 ? '#27ae60' : pct > 0.3 ? '#e67e22' : '#c0392b';
    ctx.fillRect(bx, by, bw * pct, bh);
  }
}
