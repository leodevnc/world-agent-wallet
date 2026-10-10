import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.mjs";
import { WalletEngine } from "../src/engine.mjs";
import { DemoAdapter } from "../src/adapters/demo.mjs";
import { money, formatMoney } from "../src/utils.mjs";
import { fixture, request } from "./helpers.mjs";

test("USDC uses integer millionths and rejects ambiguous/negative/oversized input", () => {
  assert.equal(money("0.000001"), 1);
  assert.equal(money("2.000001"), 2_000_001);
  assert.equal(formatMoney(200_000), "0.2");
  for (const bad of ["-1", "1e6", "NaN", "01", "1.0000001", "1000000", 1, null])
    assert.throws(() => money(bad));
});
test("automatic request executes once and returns a stable receipt on replay", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  assert.equal(op.status, "ready");
  const first = await f.engine.execute(f.a.id, op.id);
  const second = await f.engine.execute(f.a.id, op.id);
  assert.equal(first.status, "succeeded");
  assert.deepEqual(second, first);
  assert.equal(f.engine.budget().committed, "0.2");
});
test("approval-required BESS request does not debit before bound approval", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request("bess-analysis"));
  assert.equal(op.status, "awaiting_approval");
  await assert.rejects(f.engine.execute(f.a.id, op.id), {
    code: "APPROVAL_REQUIRED",
  });
  assert.equal(f.engine.budget().committed, "0");
  assert.throws(() => f.engine.approve(op.id, { actionDigest: "wrong" }), {
    code: "APPROVAL_MISMATCH",
  });
  f.engine.approve(op.id, { actionDigest: op.actionDigest });
  const receipt = await f.engine.execute(f.a.id, op.id);
  assert.equal(receipt.result.discharge_energy_limit_mwh, 90.24);
  assert.equal(receipt.result.gross_energy_value_usd, 8572.8);
});
test("idempotency keys are bound to canonical input and scoped per agent", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const req = request("market-snapshot", "same-key-123");
  const one = await f.engine.prepare(f.a.id, req);
  assert.equal((await f.engine.prepare(f.a.id, req)).id, one.id);
  await assert.rejects(
    f.engine.prepare(f.a.id, request("bess-analysis", "same-key-123")),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.notEqual((await f.engine.prepare(f.b.id, req)).id, one.id);
});
test("agents cannot supply their own amount, destination, approval or raw URL", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  for (const extra of [
    { amount: 0 },
    { url: "https://evil.example" },
    { approved: true },
    { payTo: "other" },
  ])
    await assert.rejects(f.engine.prepare(f.a.id, { ...request(), ...extra }));
  await assert.rejects(
    f.engine.prepare(f.a.id, request("https://evil.example")),
    { code: "SERVICE_NOT_ALLOWED" },
  );
});
test("26 concurrent requests from two agents cannot overspend a shared 5 USDC budget", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const ops = await Promise.all(
    Array.from({ length: 26 }, (_, i) =>
      f.engine.prepare(i % 2 ? f.a.id : f.b.id, request()),
    ),
  );
  const results = await Promise.allSettled(
    ops.map((op) => f.engine.execute(op.agentId, op.id)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 25);
  assert.equal(
    results.filter(
      (r) => r.status === "rejected" && r.reason.code === "DAILY_LIMIT",
    ).length,
    1,
  );
  assert.equal(f.engine.budget().committed, "5");
});
test("parallel duplicate execution makes exactly one external call", async (t) => {
  let release,
    calls = 0;
  const adapter = new DemoAdapter();
  adapter.execute = async (op) => {
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
    return {
      amountMicros: op.amountMicros,
      data: {},
      settlement: { status: "simulated" },
    };
  };
  const f = fixture({ adapter });
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  const first = f.engine.execute(f.a.id, op.id);
  await assert.rejects(f.engine.execute(f.a.id, op.id), {
    code: "INVALID_STATE",
  });
  release();
  await first;
  assert.equal(calls, 1);
});
test("approval never bypasses daily budget", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  await assert.rejects(f.engine.prepare(f.a.id, request("deep-review")), {
    code: "DAILY_LIMIT",
  });
  const ops = await Promise.all(
    Array.from({ length: 3 }, () =>
      f.engine.prepare(f.a.id, request("bess-analysis")),
    ),
  );
  for (const op of ops)
    f.engine.approve(op.id, { actionDigest: op.actionDigest });
  await f.engine.execute(f.a.id, ops[0].id);
  await f.engine.execute(f.a.id, ops[1].id);
  await assert.rejects(f.engine.execute(f.a.id, ops[2].id), {
    code: "DAILY_LIMIT",
  });
});
test("revocation invalidates pending and approved requests before execution", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  f.engine.revoke(f.a.id);
  await assert.rejects(f.engine.execute(f.a.id, op.id), {
    code: "AGENT_REVOKED",
  });
  assert.equal(f.engine.budget().committed, "0");
});
test("changing policy or catalog invalidates an unexecuted quote", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  f.engine.changePolicy({ daily_limit: "4", auto_limit: "1" });
  await assert.rejects(f.engine.execute(f.a.id, op.id), {
    code: "POLICY_CHANGED",
  });
  const next = await f.engine.prepare(f.a.id, request());
  f.config.services[0] = { ...f.config.services[0], price: "0.3" };
  await assert.rejects(f.engine.execute(f.a.id, next.id), {
    code: "CATALOG_CHANGED",
  });
});
test("quotes and approvals expire", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request("bess-analysis"));
  f.setTime(op.expiresAt);
  assert.throws(
    () => f.engine.approve(op.id, { actionDigest: op.actionDigest }),
    { code: "EXPIRED" },
  );
});
test("Korean midnight changes the authorization-day budget", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.setTime(Date.parse("2026-10-10T14:59:00Z"));
  const op = await f.engine.prepare(f.a.id, request());
  await f.engine.execute(f.a.id, op.id);
  assert.equal(f.engine.budget().day, "2026-10-10");
  f.setTime(Date.parse("2026-10-10T15:00:00Z"));
  assert.equal(f.engine.budget().day, "2026-10-11");
  assert.equal(f.engine.budget().committed, "0");
});
test("unknown outcome retains reservation and cannot be automatically retried", async (t) => {
  const adapter = new DemoAdapter();
  adapter.execute = async () => {
    throw new Error("timeout");
  };
  const f = fixture({ adapter });
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  const result = await f.engine.execute(f.a.id, op.id);
  assert.equal(result.status, "uncertain");
  assert.equal(f.engine.budget().committed, "0.2");
  await assert.rejects(f.engine.execute(f.a.id, op.id), {
    code: "INVALID_STATE",
  });
  f.engine.acknowledgeUncertain(op.id);
  assert.equal(f.engine.budget().committed, "0.2");
  assert.equal(f.store.op(op.id).status, "charged_unconfirmed");
});
test("known pre-transmission failure releases only the unused reservation", async (t) => {
  const adapter = new DemoAdapter();
  adapter.execute = async () => {
    const e = new Error("signing failed");
    e.definitelyUnsent = true;
    throw e;
  };
  const f = fixture({ adapter });
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  assert.equal((await f.engine.execute(f.a.id, op.id)).status, "failed");
  assert.equal(f.engine.budget().committed, "0");
});
test("provider cannot settle above the reserved amount", async (t) => {
  const adapter = new DemoAdapter();
  adapter.execute = async () => ({
    amountMicros: 999999999,
    data: {},
    settlement: {},
  });
  const f = fixture({ adapter });
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  assert.equal((await f.engine.execute(f.a.id, op.id)).status, "uncertain");
  assert.equal(f.engine.budget().committed, "0.2");
});
test("other agents cannot execute or read receipts", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const op = await f.engine.prepare(f.a.id, request());
  assert.throws(() => f.engine.get(f.b.id, op.id), { code: "NOT_FOUND" });
  await assert.rejects(f.engine.execute(f.b.id, op.id), { code: "NOT_FOUND" });
});
test("persisted in-flight operations become uncertain after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wallet-restart-"));
  const path = join(dir, "wallet.sqlite");
  const f = fixture({ path });
  const op = await f.engine.prepare(f.a.id, request());
  const raw = f.store.op(op.id);
  raw.status = "executing";
  raw.reservedDay = "2026-10-10";
  f.store.save(raw);
  f.store.close();
  const store = new Store(path);
  const engine = new WalletEngine({
    store,
    config: f.config,
    adapter: new DemoAdapter(),
    clock: f.clock,
  });
  assert.equal(store.op(op.id).status, "uncertain");
  assert.equal(engine.budget().committed, "0.2");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
test("mode or timezone cannot reinterpret an existing ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "wallet-mode-"));
  const path = join(dir, "wallet.sqlite");
  const s = new Store(path);
  s.close();
  assert.throws(() => new Store(path, { mode: "x402" }), /Mode\/timezone/);
  rmSync(dir, { recursive: true, force: true });
});
test("invalid BESS constraints are rejected before quoting", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  await assert.rejects(
    f.engine.prepare(
      f.a.id,
      request("bess-analysis", crypto.randomUUID(), {
        soc: 0.1,
        min_soc: 0.15,
      }),
    ),
  );
  assert.equal(f.store.list().length, 0);
});
test("an enrolled owner cannot fall back to demo approval", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.store.set("world_owner", { nullifier: "1" });
  const op = await f.engine.prepare(f.a.id, request("bess-analysis"));
  assert.throws(
    () => f.engine.approve(op.id, { actionDigest: op.actionDigest }),
    { code: "WORLD_VERIFICATION_REQUIRED" },
  );
});
