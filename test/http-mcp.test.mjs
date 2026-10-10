import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createWalletServer } from "../src/http.mjs";
import { WorldIdentity } from "../src/adapters/world-id.mjs";
import { hash, token } from "../src/utils.mjs";
import { fixture, request } from "./helpers.mjs";

async function serverFixture(t) {
  const f = fixture();
  const secret = token();
  f.store.set("admin_token_hash", hash(secret));
  const identity = new WorldIdentity({ ...f, config: f.config.world });
  const server = createWalletServer({ ...f, identity });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    f.store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (
    path,
    { body, credential = f.a.token, headers = {} } = {},
  ) => {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + credential,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
  return { ...f, base, call, secret };
}
test("HTTP requires separate operator and agent credentials", async (t) => {
  const f = await serverFixture(t);
  assert.equal(
    (await f.call("/api/status", { credential: "wrong" })).status,
    401,
  );
  assert.equal((await f.call("/api/admin/state")).status, 401);
  assert.equal(
    (await f.call("/api/admin/state", { credential: f.secret })).status,
    200,
  );
  assert.equal(
    (await f.call("/api/status", { credential: f.secret })).status,
    401,
  );
});
test("agents cannot change policy, approve, or create more agents", async (t) => {
  const f = await serverFixture(t);
  const op = await f.engine.prepare(f.a.id, request("bess-analysis"));
  for (const [path, body] of [
    ["/api/admin/policy", { daily_limit: "999", auto_limit: "999" }],
    ["/api/admin/agents", { name: "rogue" }],
    [
      `/api/admin/operations/${op.id}/approve`,
      { actionDigest: op.actionDigest },
    ],
  ])
    assert.equal((await f.call(path, { body })).status, 401);
  assert.equal(f.engine.budget().dailyLimit, "5");
  assert.equal(f.store.op(op.id).status, "awaiting_approval");
});
test("browser cross-origin API attempts are rejected", async (t) => {
  const f = await serverFixture(t);
  const r = await f.call("/api/admin/state", {
    credential: f.secret,
    headers: { origin: "https://evil.example" },
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, "ORIGIN");
});
test("HTTP execute rejects extra payment/approval parameters", async (t) => {
  const f = await serverFixture(t);
  const p = await f.call("/api/operations", { body: request() });
  const r = await f.call(`/api/operations/${p.data.id}/execute`, {
    body: { amount: 0, approved: true },
  });
  assert.equal(r.status, 400);
  assert.equal(f.engine.budget().committed, "0");
});
test("HTTP owner approval cannot accept an agent-supplied verified flag", async (t) => {
  const f = await serverFixture(t);
  const op = await f.engine.prepare(f.a.id, request("bess-analysis"));
  f.store.set("world_owner", { nullifier: "1" });
  const r = await f.call(`/api/admin/operations/${op.id}/approve`, {
    credential: f.secret,
    body: { actionDigest: op.actionDigest, verified: true },
  });
  assert.equal(r.status, 400);
});
test("MCP SDK performs discovery, automatic payment, human approval, and receipt replay end to end", async (t) => {
  const f = await serverFixture(t);
  const dir = mkdtempSync(join(tmpdir(), "wallet-mcp-"));
  const credentialFile = join(dir, "agent.json");
  writeFileSync(credentialFile, JSON.stringify(f.a), { mode: 0o600 });
  const client = new Client({
    name: "wallet-integration-test",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("src/mcp.mjs")],
    env: {
      PATH: process.env.PATH,
      WALLET_GATEWAY_URL: f.base,
      WALLET_AGENT_FILE: credentialFile,
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  assert.ok(
    !tools.tools.some((t) => /approve|policy|private_key/.test(t.name)),
  );
  const invoke = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...result, data: JSON.parse(result.content[0].text) };
  };
  assert.equal((await invoke("wallet_status")).data.budget.remaining, "5");
  const prepared = await invoke("prepare_payment", request());
  assert.equal(prepared.data.status, "ready");
  const paid = await invoke("execute_payment", {
    operation_id: prepared.data.id,
  });
  assert.equal(paid.data.status, "succeeded");
  const repeat = await invoke("execute_payment", {
    operation_id: prepared.data.id,
  });
  assert.equal(
    repeat.data.settlement.reference,
    paid.data.settlement.reference,
  );
  const pending = await invoke("prepare_payment", request("bess-analysis"));
  assert.equal(pending.data.status, "awaiting_approval");
  const blocked = await invoke("execute_payment", {
    operation_id: pending.data.id,
  });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.data.error.code, "APPROVAL_REQUIRED");
  const approved = await f.call(
    `/api/admin/operations/${pending.data.id}/approve`,
    { credential: f.secret, body: { actionDigest: pending.data.actionDigest } },
  );
  assert.equal(approved.status, 200);
  const done = await invoke("execute_payment", {
    operation_id: pending.data.id,
  });
  assert.equal(done.data.status, "succeeded");
  assert.equal((await invoke("wallet_status")).data.budget.remaining, "2.8");
  assert.equal((await invoke("list_receipts")).data.length, 2);
  assert.equal(stderr.includes(f.secret), false);
  assert.equal(stderr.includes(f.a.token), false);
});
