import { DurableObject } from "cloudflare:workers";

// ============================================================
// Types
// ============================================================

interface Env {
  BATTLE_MAP: DurableObjectNamespace<BattleMapDO>;
  ASSETS: Fetcher;
}

interface Cell {
  terrain: string;
  elevation: number;
  feature: string | null;
  token: object | null;
}

interface GameState {
  width: number;
  height: number;
  cells: Cell[][];
}

// ============================================================
// Worker entry point — routes WebSocket upgrades to the DO,
// everything else to static assets
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // WebSocket upgrade → Durable Object
    if (request.headers.get("Upgrade") === "websocket") {
      // All clients share a single room (keyed "global")
      const id = env.BATTLE_MAP.idFromName("global");
      const stub = env.BATTLE_MAP.get(id);
      return stub.fetch(request);
    }

    // All other requests → static assets (public/)
    return env.ASSETS.fetch(request);
  },
};

// ============================================================
// Durable Object — holds game state + manages WebSocket sessions
// ============================================================

export class BattleMapDO extends DurableObject<Env> {
  private gameState!: GameState;
  private initialized = false;

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private makeCell(): Cell {
    return { terrain: "grass", elevation: 0, feature: null, token: null };
  }

  private makeDefaultState(w = 20, h = 20): GameState {
    const cells: Cell[][] = [];
    for (let r = 0; r < h; r++) {
      cells[r] = [];
      for (let c = 0; c < w; c++) {
        cells[r][c] = this.makeCell();
      }
    }
    return { width: w, height: h, cells };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    const stored = await this.ctx.storage.get<GameState>("gameState");
    this.gameState = stored ?? this.makeDefaultState();
    this.initialized = true;
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put("gameState", this.gameState);
  }

  private broadcast(message: string, exclude?: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  // ----------------------------------------------------------
  // HTTP fetch — accepts WebSocket upgrades
  // ----------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    // Send full state to the new client
    server.send(JSON.stringify({ type: "init", state: this.gameState }));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ----------------------------------------------------------
  // WebSocket message handler
  // ----------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureInitialized();

    let data: any;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    switch (data.type) {
      case "update_cell": {
        const { row, col, cell, clientSeq } = data;
        if (this.gameState.cells[row]?.[col]) {
          this.gameState.cells[row][col] = cell;
          await this.persistState();

          // ACK to sender
          ws.send(JSON.stringify({
            type: "cell_ack",
            row,
            col,
            clientSeq,
          }));

          // Broadcast to everyone else
          this.broadcast(JSON.stringify({
            type: "update_cell",
            row,
            col,
            cell,
          }), ws);
        }
        break;
      }

      case "move_token": {
        const { from, to, clientSeq } = data;
        if (
          this.gameState.cells[from.row]?.[from.col] &&
          this.gameState.cells[to.row]?.[to.col]
        ) {
          this.gameState.cells[to.row][to.col].token =
            this.gameState.cells[from.row][from.col].token;
          this.gameState.cells[from.row][from.col].token = null;
          await this.persistState();

          // ACK to sender
          ws.send(JSON.stringify({
            type: "move_ack",
            from,
            to,
            clientSeq,
          }));

          // Broadcast to everyone else
          this.broadcast(JSON.stringify({
            type: "move_token",
            from,
            to,
          }), ws);
        }
        break;
      }

      case "set_map": {
        this.gameState = data.state;
        await this.persistState();

        // Broadcast the new map to everyone else
        this.broadcast(JSON.stringify({
          type: "set_map",
          state: this.gameState,
        }), ws);
        break;
      }

      case "roll_dice": {
        // Broadcast the dice roll to ALL clients (including sender, so
        // everyone sees the same animation with the same results)
        const msg = JSON.stringify(data);
        for (const session of this.ctx.getWebSockets()) {
          if (session.readyState === WebSocket.OPEN) {
            session.send(msg);
          }
        }
        break;
      }
    }
  }

  // ----------------------------------------------------------
  // WebSocket close / error
  // ----------------------------------------------------------

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Nothing to clean up — ctx.getWebSockets() auto-removes closed sockets
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close();
  }
}
