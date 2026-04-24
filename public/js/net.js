// ============================================================
// WebSocket connection + message handling
// ============================================================

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
let socket;
let clientSeq = 0;
let pendingUpdates = {};

function sendWithSeq(data) {
  data.clientSeq = ++clientSeq;
  pendingUpdates[data.clientSeq] = data;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function handleMessage(event) {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'init':
      mapData = data.state;
      document.getElementById('mapW').value = mapData.width;
      document.getElementById('mapH').value = mapData.height;
      centerMap();
      render();
      break;

    case 'update_cell':
      if (mapData.cells[data.row]?.[data.col]) {
        mapData.cells[data.row][data.col] = data.cell;
        render();
        setTimeout(renderInitList, 50);
      }
      break;

    case 'move_token': {
      const { from, to } = data;
      if (mapData.cells[from.row]?.[from.col] && mapData.cells[to.row]?.[to.col]) {
        mapData.cells[to.row][to.col].token =
          mapData.cells[from.row][from.col].token;
        mapData.cells[from.row][from.col].token = null;
        render();
        setTimeout(renderInitList, 50);
      }
      break;
    }

    case 'set_map':
      mapData = data.state;
      document.getElementById('mapW').value = mapData.width;
      document.getElementById('mapH').value = mapData.height;
      render();
      break;

    case 'cell_ack':
    case 'move_ack':
      delete pendingUpdates[data.clientSeq];
      break;

    case 'roll_dice':
      showDiceRoll(data.count, data.sides, data.results);
      break;
  }
}

function connect() {
  socket = new WebSocket(`${protocol}://${location.host}`);
  socket.onmessage = handleMessage;
  socket.onclose = () => {
    console.log('WebSocket disconnected, reconnecting in 1s...');
    setTimeout(connect, 1000);
  };
  socket.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

// Start the connection
connect();
