// ============================================================
// Save / Load / Export
// ============================================================

const fs = require('fs');
const readline = require('readline')

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

async function readFileByLine(path) {
    const fileStream = fs.createReadStream(path);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        
    }
}