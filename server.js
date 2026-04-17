const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// ===============================
// HTTP SERVER (serves index.html)
// ===============================
const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // basic content type handling
    const ext = path.extname(filePath);
    const typeMap = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css'
    };

    res.writeHead(200, {
      'Content-Type': typeMap[ext] || 'text/plain'
    });

    res.end(content);
  });
});

// ===============================
// WEBSOCKET SERVER
// ===============================
const wss = new WebSocket.Server({ server });

// ===============================
// GAME STATE
// ===============================
let gameState = {
  width: 20,
  height: 20,
  cells: []
};

function makeCell() {
  return { terrain: 'grass', elevation: 0, feature: null, token: null };
}

function initMap(w, h) {
  gameState.width = w;
  gameState.height = h;
  gameState.cells = [];
  for (let r = 0; r < h; r++) {
    gameState.cells[r] = [];
    for (let c = 0; c < w; c++) {
      gameState.cells[r][c] = makeCell();
    }
  }
}

initMap(20, 20);

// ===============================
// BROADCAST HELPER
// ===============================
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ===============================
// CONNECTION HANDLING
// ===============================
wss.on('connection', ws => {
  console.log('Client connected');

  // Send full state on connect
  ws.send(JSON.stringify({
    type: 'init',
    state: gameState
  }));

  ws.on('message', message => {
    let data;

    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error('Invalid JSON:', message);
      return;
    }

    switch (data.type) {
      case 'update_cell': {
        const { row, col, cell } = data;
        if (gameState.cells[row] && gameState.cells[row][col]) {
          gameState.cells[row][col] = cell;
        }
        break;
      }

      case 'move_token': {
        const { from, to } = data;
        if (
          gameState.cells[from.row]?.[from.col] &&
          gameState.cells[to.row]?.[to.col]
        ) {
          gameState.cells[to.row][to.col].token =
            gameState.cells[from.row][from.col].token;
          gameState.cells[from.row][from.col].token = null;
        }
        break;
      }

      case 'set_map': {
        gameState = data.state;
        break;
      }
    }

    // 🔥 Broadcast to ALL clients (including sender)
    broadcast(data);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// ===============================
// START SERVER
// ===============================
const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});