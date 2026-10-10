import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import {
  WorldIdentity,
  signalHash,
  normalizeField,
} from "../src/adapters/world-id.mjs";
import { fixture, request } from "./helpers.mjs";

function identityFixture(t) {
  const f = fixture();
  t.after(() => f.store.close());
  const config = {
    appId: "app_test",
    rpId: "rp_test",
    signingKey: generatePrivateKey(),
    action: "wallet-test",
    environment: "staging",
  };
  let verifyCalls = 0;
  const identity = new WorldIdentity({
    ...f,
    config,
    fetchFn: async (url, init) => {
      verifyCalls++;
      const p = JSON.parse(init.body);
      return Response.json({
        success: true,
        environment: p.environment,
        action: p.action,
        results: [
          {
            success: true,
            identifier: "proof_of_human",
            nullifier: p.responses[0].nullifier,
          },
        ],
      });
    },
  });
  const proof = (c, nullifier = "0x01") => ({
    protocol_version: "4.0",
    action: c.action,
    environment: c.environment,
    nonce: c.rp_context.nonce,
    responses: [
      {
        identifier: "proof_of_human",
        issuer_schema_id: 1,
        signal_hash: "0x" + BigInt(signalHash(c.signal)).toString(16),
        nullifier,
        proof: ["fixture"],
        expires_at_min: 9999999999,
      },
    ],
  });
  return { ...f, identity, proof, verifyCalls: () => verifyCalls };
}
test("World enrollment pins the verified human and consumes challenge once", async (t) => {
  const f = identityFixture(t);
  const c = f.identity.challenge("enroll");
  await f.identity.verify(c.id, f.proof(c));
  assert.equal(f.store.get("world_owner").nullifier, "1");
  await assert.rejects(f.identity.verify(c.id, f.proof(c)), {
    code: "WORLD_CHALLENGE",
  });
  assert.equal(f.verifyCalls(), 1);
});
test("wrong environment, nonce, action, schema and signal are rejected before external verification", async (t) => {
  const f = identityFixture(t);
  const c = f.identity.challenge("enroll");
  const cases = [
    { environment: "production" },
    { nonce: "wrong" },
    { action: "wrong" },
    { protocol_version: "3.0" },
    { responses: [{ ...f.proof(c).responses[0], issuer_schema_id: 11 }] },
    { responses: [{ ...f.proof(c).responses[0], signal_hash: "0x00" }] },
  ];
  for (const replacement of cases)
    await assert.rejects(
      f.identity.verify(c.id, { ...f.proof(c), ...replacement }),
      { code: "WORLD_PROOF" },
    );
  assert.equal(f.verifyCalls(), 0);
  assert.equal(f.store.get("world_owner"), null);
});
test("only the enrolled human can approve a specific operation", async (t) => {
  const f = identityFixture(t);
  const signup = f.identity.challenge("enroll");
  await f.identity.verify(signup.id, f.proof(signup));
  const op = await f.engine.prepare(f.a.id, request("bess-analysis"));
  const c = f.identity.challenge("approve", op.id);
  await assert.rejects(f.identity.verify(c.id, f.proof(c, "0x02")), {
    code: "WRONG_OWNER",
  });
  assert.equal(f.store.op(op.id).status, "awaiting_approval");
  await f.identity.verify(c.id, f.proof(c, "1"));
  assert.equal(f.store.op(op.id).approved.method, "world_id");
  assert.equal(f.store.op(op.id).status, "ready");
});
test("approval for one operation cannot be replayed on another challenge", async (t) => {
  const f = identityFixture(t);
  const signup = f.identity.challenge("enroll");
  await f.identity.verify(signup.id, f.proof(signup));
  const a = await f.engine.prepare(f.a.id, request("bess-analysis"));
  const b = await f.engine.prepare(f.a.id, request("bess-analysis"));
  const ca = f.identity.challenge("approve", a.id);
  const cb = f.identity.challenge("approve", b.id);
  const p = f.proof(ca);
  p.nonce = cb.rp_context.nonce;
  await assert.rejects(f.identity.verify(cb.id, p), { code: "WORLD_PROOF" });
});
test("HTTP 200 alone does not establish successful proof verification", async (t) => {
  const f = identityFixture(t);
  f.identity.fetchFn = async () =>
    Response.json({ success: false, environment: "staging" });
  const c = f.identity.challenge("enroll");
  await assert.rejects(f.identity.verify(c.id, f.proof(c)), {
    code: "WORLD_VERIFY_FAILED",
  });
  assert.equal(f.store.get("world_owner"), null);
});
test("expired World challenge cannot approve", async (t) => {
  const f = identityFixture(t);
  const c = f.identity.challenge("enroll");
  f.setTime(f.clock() + 300001);
  await assert.rejects(f.identity.verify(c.id, f.proof(c)), {
    code: "WORLD_CHALLENGE",
  });
});
test("field elements are normalized; malformed, negative and too-large values fail", () => {
  assert.equal(normalizeField("0x000A"), normalizeField("10"));
  for (const bad of [
    "-1",
    "NaN",
    "0x",
    "0x" + "f".repeat(65),
    "9".repeat(79),
    null,
  ])
    assert.throws(() => normalizeField(bad));
});
