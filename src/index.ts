import { DurableObject } from "cloudflare:workers";
// @ts-ignore — plain JS module shared with the browser
import { initialState, applyOp, canApply, redactState, playerMessages, inspectBefore, SECTIONS, PLAYER_ROUND_TRIP, checkAttack, ownsToken } from "../public/js/core/ops.js";

// ============================================================
// Types
// ============================================================

interface Env {
  BATTLE_MAP: DurableObjectNamespace<BattleMapDO>;
  ASSETS: Fetcher;
}

interface Session {
  name: string;
  role: "dm" | "player";
}

interface RoomRecord {
  code: string;
  created: number;
  dm: { salt: string; hash: string };
  player: { salt: string; hash: string } | null;
}

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const FILE_CHUNK = 1024 * 1024; // SQLite rows max out at 2 MB
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// ============================================================
// Helpers
// ============================================================

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

function genCode(len = 6): string {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return [...b].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const cleanName = (n: unknown) => String(n ?? "").trim().slice(0, 32);

// ============================================================
// Worker entry point — /api/rooms/* goes to the room's Durable
// Object, everything else is a static asset from public/
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.text();
      for (let i = 0; i < 5; i++) {
        const code = genCode();
        const stub = env.BATTLE_MAP.get(env.BATTLE_MAP.idFromName(code));
        const res = await stub.fetch(`https://room/create?code=${code}`, { method: "POST", body });
        if (res.status !== 409) return res;
      }
      return json({ error: "Could not allocate a room code, try again" }, 500);
    }

    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,12})(\/[^?]*)$/);
    if (m) {
      const code = m[1].toUpperCase();
      const stub = env.BATTLE_MAP.get(env.BATTLE_MAP.idFromName(code));
      const inner = new URL(request.url);
      inner.pathname = m[2];
      inner.searchParams.set("code", code);
      return stub.fetch(new Request(inner.toString(), request));
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

// ============================================================
// Durable Object — one per room: holds campaign state, sessions,
// uploaded images, and the WebSocket fan-out
// ============================================================

export class BattleMapDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private state: any = null;
  private failedJoins: number[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, created INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, created INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS file_chunks (id TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, idx))`);
  }

  // ----------------------------------------------------------
  // Storage helpers
  // ----------------------------------------------------------

  private getKV<T>(k: string): T | undefined {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray();
    return rows.length ? JSON.parse(rows[0].v as string) : undefined;
  }

  private putKV(k: string, v: unknown): void {
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
  }

  private room(): RoomRecord | undefined {
    return this.getKV<RoomRecord>("room");
  }

  private loadState(): any {
    if (this.state) return this.state;
    const s = initialState();
    for (const key of SECTIONS) {
      const v = this.getKV(`s:${key}`);
      if (v !== undefined) s[key] = v;
    }
    this.state = s;
    return s;
  }

  private createSession(name: string, role: Session["role"]): string {
    const token = randomHex(24);
    this.sql.exec("INSERT INTO sessions (token, name, role, created) VALUES (?, ?, ?, ?)", token, name, role, Date.now());
    return token;
  }

  private session(token: string | null): Session | null {
    if (!token) return null;
    const rows = this.sql.exec("SELECT name, role FROM sessions WHERE token = ?", token).toArray();
    return rows.length ? { name: rows[0].name as string, role: rows[0].role as Session["role"] } : null;
  }

  // ----------------------------------------------------------
  // HTTP routes (paths are relative to /api/rooms/:code)
  // ----------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const code = url.searchParams.get("code") ?? "";

    if (path === "/create" && request.method === "POST") return this.handleCreate(request, code);

    const room = this.room();
    if (!room) return json({ error: "Room not found" }, 404);

    if (path === "/join" && request.method === "POST") return this.handleJoin(request, room);

    const token = request.headers.get("x-room-token") ?? url.searchParams.get("t");
    const sess = this.session(token);
    if (!sess) return json({ error: "Not signed in to this room" }, 401);

    if (path === "/me") {
      return json({ code: room.code, name: sess.name, role: sess.role, roomName: this.loadState().meta.name });
    }
    if (path === "/ws") return this.handleWebSocket(request, sess);
    if (path === "/files" && request.method === "POST") return this.handleUpload(request);
    const fm = path.match(/^\/files\/([a-f0-9]{16,64})$/);
    if (fm && request.method === "GET") return this.handleDownload(fm[1]);
    const dm = path.match(/^\/ddb\/(\d{1,12})$/);
    if (dm) return this.handleDdb(dm[1]);

    return json({ error: "Not found" }, 404);
  }

  private async handleCreate(request: Request, code: string): Promise<Response> {
    if (this.room()) return json({ error: "exists" }, 409);
    const body: any = await request.json().catch(() => ({}));
    const name = cleanName(body.name);
    const dmPassword = String(body.dmPassword ?? "");
    const playerPassword = String(body.playerPassword ?? "");
    if (!name) return json({ error: "Enter your name" }, 400);
    if (dmPassword.length < 4) return json({ error: "DM password must be at least 4 characters" }, 400);
    if (playerPassword && playerPassword === dmPassword) return json({ error: "Player and DM passwords must differ" }, 400);

    const dmSalt = randomHex(16);
    const record: RoomRecord = {
      code,
      created: Date.now(),
      dm: { salt: dmSalt, hash: await hashPassword(dmPassword, dmSalt) },
      player: null,
    };
    if (playerPassword) {
      const salt = randomHex(16);
      record.player = { salt, hash: await hashPassword(playerPassword, salt) };
    }
    this.putKV("room", record);

    const state = this.loadState();
    state.meta.name = String(body.roomName || "").trim().slice(0, 80) || "New Campaign";
    this.putKV("s:meta", state.meta);

    const token = this.createSession(name, "dm");
    return json({ code, token, role: "dm", name, roomName: state.meta.name });
  }

  private async handleJoin(request: Request, room: RoomRecord): Promise<Response> {
    const now = Date.now();
    this.failedJoins = this.failedJoins.filter(t => now - t < 60_000);
    if (this.failedJoins.length >= 8) return json({ error: "Too many attempts — wait a minute" }, 429);

    const body: any = await request.json().catch(() => ({}));
    const name = cleanName(body.name);
    const password = String(body.password ?? "");
    if (!name) return json({ error: "Enter your name" }, 400);

    let role: Session["role"] | null = null;
    if (password && timingSafeEqual(await hashPassword(password, room.dm.salt), room.dm.hash)) role = "dm";
    else if (room.player && password && timingSafeEqual(await hashPassword(password, room.player.salt), room.player.hash)) role = "player";
    else if (!room.player && !password) role = "player";

    if (!role) {
      this.failedJoins.push(now);
      return json({ error: "Wrong password" }, 401);
    }
    const token = this.createSession(name, role);
    return json({ code: room.code, token, role, name, roomName: this.loadState().meta.name });
  }

  private handleWebSocket(request: Request, sess: Session): Response {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected WebSocket" }, 426);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...sess, sid: randomHex(6) });
    this.sendSync(server, sess);
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleUpload(request: Request): Promise<Response> {
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return json({ error: "Only PNG, JPEG, WebP or GIF images" }, 415);
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) return json({ error: "Empty file" }, 400);
    if (buf.byteLength > MAX_FILE_BYTES) return json({ error: "Image too large (12 MB max)" }, 413);

    const id = randomHex(16);
    const chunks = Math.ceil(buf.byteLength / FILE_CHUNK);
    for (let i = 0; i < chunks; i++) {
      this.sql.exec("INSERT INTO file_chunks (id, idx, data) VALUES (?, ?, ?)", id, i, buf.slice(i * FILE_CHUNK, (i + 1) * FILE_CHUNK));
    }
    this.sql.exec("INSERT INTO files (id, type, size, chunks, created) VALUES (?, ?, ?, ?, ?)", id, type, buf.byteLength, chunks, Date.now());
    return json({ id });
  }

  private handleDownload(id: string): Response {
    const meta = this.sql.exec("SELECT type, size FROM files WHERE id = ?", id).toArray();
    if (!meta.length) return json({ error: "Not found" }, 404);
    const out = new Uint8Array(meta[0].size as number);
    let offset = 0;
    for (const row of this.sql.exec("SELECT data FROM file_chunks WHERE id = ? ORDER BY idx", id)) {
      const chunk = new Uint8Array(row.data as ArrayBuffer);
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(out, {
      headers: { "content-type": meta[0].type as string, "cache-control": "private, max-age=31536000, immutable" },
    });
  }

  // D&D Beyond blocks browser CORS, so the room fetches public sheets on the client's behalf
  private async handleDdb(charId: string): Promise<Response> {
    const res = await fetch(`https://character-service.dndbeyond.com/character/v5/character/${charId}`, {
      headers: { "user-agent": "Mozilla/5.0 (dnd-battle-map)", accept: "application/json" },
    });
    if (!res.ok) {
      return json({ error: res.status === 403 || res.status === 404 ? "Character not found or not public on D&D Beyond" : `D&D Beyond returned ${res.status}` }, 502);
    }
    return new Response(res.body, { headers: { "content-type": "application/json" } });
  }

  // ----------------------------------------------------------
  // WebSocket plumbing
  // ----------------------------------------------------------

  private sendSync(ws: WebSocket, sess: Session): void {
    const state = this.loadState();
    ws.send(JSON.stringify({
      type: "sync",
      state: sess.role === "dm" ? state : redactState(state),
      me: sess,
    }));
  }

  private broadcastPresence(): void {
    const users = this.ctx.getWebSockets()
      .filter(ws => ws.readyState === WebSocket.OPEN)
      .map(ws => ws.deserializeAttachment() as Session & { sid: string })
      .map(a => ({ name: a.name, role: a.role, sid: a.sid }));
    const msg = JSON.stringify({ type: "presence", users });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    const sess = ws.deserializeAttachment() as Session;

    if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
    if (msg.type === "resync") { this.sendSync(ws, sess); return; }
    if (msg.type === "check") {
      // A player's roll window asks whether its attack rolls hit (AC stays secret)
      const state = this.loadState();
      const actor = state.battle.tokens[msg.actorId];
      const reply = actor && ownsToken(state, sess, actor)
        ? { type: "checkResult", reqId: msg.reqId, results: (msg.rolls ?? []).map((r: any) => checkAttack(state, r)) }
        : { type: "checkResult", reqId: msg.reqId, error: "Not your token" };
      ws.send(JSON.stringify(reply));
      return;
    }
    if (msg.type === "fx") {
      // Transient visual pings (e.g. "look here") — not persisted
      const out = JSON.stringify({ type: "fx", fx: msg.fx, by: sess.name });
      for (const other of this.ctx.getWebSockets()) if (other !== ws && other.readyState === WebSocket.OPEN) other.send(out);
      return;
    }
    if (msg.type !== "op" || !msg.op) return;

    const state = this.loadState();
    const op = msg.op;
    op.by = sess.name;
    op.ts = typeof op.ts === "number" ? op.ts : Date.now();
    if (typeof op.id !== "string") op.id = randomHex(6);

    const allowed = canApply(op, sess, state);
    if (allowed !== true) {
      ws.send(JSON.stringify({ type: "reject", seq: msg.seq, reason: allowed }));
      this.sendSync(ws, sess);
      return;
    }

    let touched: string[];
    const before = inspectBefore(op, state);
    try {
      touched = applyOp(state, op);
    } catch (err) {
      // A half-applied op may have corrupted memory — reload from disk
      this.state = null;
      ws.send(JSON.stringify({ type: "reject", seq: msg.seq, reason: "Server error: " + (err as Error).message }));
      this.sendSync(ws, sess);
      return;
    }
    for (const key of touched) this.putKV(`s:${key}`, state[key]);

    ws.send(JSON.stringify({ type: "ack", seq: msg.seq }));

    const dmMsg = JSON.stringify({ type: "op", op });
    let playerMsgs: string[] | null = null;
    if (sess.role !== "dm" && PLAYER_ROUND_TRIP.has(op.type)) {
      // The player didn't apply this locally; send back the redacted result
      playerMsgs = playerMessages(op, before, state).map((m: unknown) => JSON.stringify(m));
      for (const m of playerMsgs!) ws.send(m);
    }
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws || other.readyState !== WebSocket.OPEN) continue;
      const a = other.deserializeAttachment() as Session;
      if (a.role === "dm") {
        other.send(dmMsg);
      } else {
        playerMsgs ??= playerMessages(op, before, state).map((m: unknown) => JSON.stringify(m));
        for (const m of playerMsgs!) other.send(m);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code, "closing"); } catch { /* already closed */ }
    this.broadcastPresence();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, "error"); } catch { /* already closed */ }
    this.broadcastPresence();
  }
}
