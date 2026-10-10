import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, token } from "./utils.mjs";

export class Store {
  constructor(
    path = ":memory:",
    { mode = "demo", timezone = "Asia/Seoul" } = {},
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), idem TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, amount INTEGER NOT NULL, reserved_day TEXT, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, UNIQUE(agent_id, idem));
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, operation_id TEXT, signal TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY, event TEXT NOT NULL, subject TEXT, at TEXT NOT NULL, data TEXT NOT NULL);`);
    if (!this.get("policy"))
      this.set("policy", {
        dailyMicros: 5_000_000,
        autoMicros: 1_000_000,
        revision: 1,
      });
    if (!this.get("mode")) {
      this.set("mode", mode);
      this.set("timezone", timezone);
    }
    if (this.get("mode") !== mode || this.get("timezone") !== timezone) {
      this.db.close();
      throw new Error(
        "Mode/timezone differs from stored ledger. Use a separate WALLET_DATA_DIR.",
      );
    }
  }
  get(key) {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key);
    return row ? JSON.parse(row.value) : null;
  }
  set(key, value) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  tx(fn) {
    if (this.inTx) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTx = true;
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.inTx = false;
    }
  }
  createAgent(name, now = Date.now()) {
    const secret = token();
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO agents (id,name,token_hash,created_at) VALUES (?,?,?,?)",
      )
      .run(id, name, hash(secret), new Date(now).toISOString());
    return { id, name, token: secret };
  }
  authenticate(secret) {
    return typeof secret === "string"
      ? this.db
          .prepare("SELECT id,name,revoked FROM agents WHERE token_hash=?")
          .get(hash(secret))
      : null;
  }
  agent(id) {
    return this.db
      .prepare("SELECT id,name,revoked FROM agents WHERE id=?")
      .get(id);
  }
  agents() {
    return this.db
      .prepare(
        "SELECT id,name,revoked,created_at FROM agents ORDER BY created_at",
      )
      .all();
  }
  op(id) {
    const r = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);
    return r
      ? { ...JSON.parse(r.data), status: r.status, reservedDay: r.reserved_day }
      : null;
  }
  byKey(agent, key) {
    const r = this.db
      .prepare("SELECT id FROM operations WHERE agent_id=? AND idem=?")
      .get(agent, key);
    return r ? this.op(r.id) : null;
  }
  save(op) {
    this.db
      .prepare(
        `INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,status=excluded.status,amount=excluded.amount,reserved_day=excluded.reserved_day`,
      )
      .run(
        op.id,
        op.agentId,
        op.idempotencyKey,
        op.fingerprint,
        JSON.stringify(op),
        op.status,
        op.amountMicros,
        op.reservedDay || null,
        op.createdAt,
        op.expiresAt,
      );
  }
  list(agentId, limit = 100) {
    const rows = agentId
      ? this.db
          .prepare(
            "SELECT id FROM operations WHERE agent_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?",
          )
          .all(agentId, limit)
      : this.db
          .prepare(
            "SELECT id FROM operations ORDER BY created_at DESC,rowid DESC LIMIT ?",
          )
          .all(limit);
    return rows.map((r) => this.op(r.id));
  }
  committed(day) {
    return this.db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM operations WHERE reserved_day=? AND status IN ('executing','succeeded','uncertain','charged_unconfirmed')",
      )
      .get(day).amount;
  }
  uncertain() {
    return this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM operations WHERE status IN ('executing','uncertain')",
      )
      .get().count;
  }
  audit(event, subject, data = {}, now = Date.now()) {
    this.db
      .prepare("INSERT INTO audits (event,subject,at,data) VALUES (?,?,?,?)")
      .run(event, subject, new Date(now).toISOString(), JSON.stringify(data));
  }
  close() {
    this.db.close();
  }
}
