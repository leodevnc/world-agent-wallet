import { randomUUID } from "node:crypto";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { keccak256, toBytes } from "viem";
import { requireThat, digest, iso } from "../utils.mjs";

export const signalHash = (signal) =>
  (BigInt(keccak256(toBytes(signal))) >> 8n).toString(10);
export function normalizeField(value) {
  requireThat(
    typeof value === "string" &&
      /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value),
    "WORLD_PROOF",
    "Malformed field element.",
  );
  const n = BigInt(value);
  requireThat(
    n >= 0n && n < 2n ** 256n,
    "WORLD_PROOF",
    "Field element out of range.",
  );
  return n.toString(10);
}
export class WorldIdentity {
  constructor({ store, engine, config, fetchFn = fetch, clock = Date.now }) {
    Object.assign(this, { store, engine, config, fetchFn, clock });
    const owner = store.get("world_owner");
    if (owner)
      requireThat(
        owner.rpId === config.rpId &&
          owner.action === config.action &&
          owner.environment === config.environment,
        "WORLD_CONFIG_CHANGED",
        "World RP/action/environment differs from the enrolled owner. Restore its configuration or use a new data directory.",
      );
  }
  configured() {
    return Boolean(
      this.config.appId && this.config.rpId && this.config.signingKey,
    );
  }
  status() {
    const owner = this.store.get("world_owner");
    return {
      configured: this.configured(),
      enrolled: Boolean(owner),
      environment: this.config.environment,
      verifiedAt: owner?.verifiedAt,
    };
  }
  challenge(purpose, operationId) {
    requireThat(
      this.configured(),
      "WORLD_NOT_CONFIGURED",
      "Set World app/RP/signing credentials to enable World ID.",
      409,
    );
    requireThat(
      ["enroll", "approve"].includes(purpose),
      "WORLD_PURPOSE",
      "Invalid verification purpose.",
    );
    const owner = this.store.get("world_owner");
    requireThat(
      purpose !== "enroll" || !owner,
      "ALREADY_ENROLLED",
      "Owner World ID is already enrolled.",
      409,
    );
    requireThat(
      purpose !== "approve" || owner,
      "ENROLL_REQUIRED",
      "Enroll the owner World ID first.",
      409,
    );
    const operation = purpose === "approve" ? this.store.op(operationId) : null;
    if (purpose === "approve") {
      requireThat(
        operation?.status === "awaiting_approval",
        "INVALID_STATE",
        "Operation is not awaiting approval.",
        409,
      );
      this.engine.checkFresh(operation);
    }
    const id = randomUUID();
    const signal =
      "world-agent-wallet:" +
      digest({
        id,
        purpose,
        operation: operation?.actionDigest || "owner-enrollment",
      });
    const signed = signRequest({
      signingKeyHex: this.config.signingKey,
      action: this.config.action,
      ttl: 300,
    });
    const expiresAt = Math.min(
      this.clock() + 300_000,
      signed.expiresAt * 1000,
      operation?.expiresAt || Infinity,
    );
    this.store.db
      .prepare("INSERT INTO challenges VALUES (?,?,?,?,?,?,0)")
      .run(id, purpose, operationId || null, signal, signed.nonce, expiresAt);
    return {
      id,
      signal,
      app_id: this.config.appId,
      action: this.config.action,
      environment: this.config.environment,
      allow_legacy_proofs: false,
      rp_context: {
        rp_id: this.config.rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  }
  async verify(challengeId, proof) {
    const c = this.store.db
      .prepare("SELECT * FROM challenges WHERE id=?")
      .get(challengeId);
    requireThat(
      c && !c.used && c.expires_at > this.clock(),
      "WORLD_CHALLENGE",
      "Verification challenge expired or was already consumed.",
      409,
    );
    requireThat(
      proof?.protocol_version === "4.0" &&
        proof.action === this.config.action &&
        proof.environment === this.config.environment &&
        proof.nonce === c.nonce &&
        !proof.session_id,
      "WORLD_PROOF",
      "Proof does not match the expected action, nonce, protocol, or environment.",
      403,
    );
    requireThat(
      Array.isArray(proof.responses) && proof.responses.length === 1,
      "WORLD_PROOF",
      "Exactly one Proof of Human is required.",
      403,
    );
    const item = proof.responses[0];
    requireThat(
      item.identifier === "proof_of_human" && item.issuer_schema_id === 1,
      "WORLD_PROOF",
      "A Proof of Human credential is required.",
      403,
    );
    requireThat(
      normalizeField(item.signal_hash) === signalHash(c.signal),
      "WORLD_PROOF",
      "Proof is not bound to the requested operation.",
      403,
    );
    const nullifier = normalizeField(item.nullifier);
    const response = await this.fetchFn(
      `https://developer.world.org/api/v4/verify/${encodeURIComponent(this.config.rpId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...proof,
          environment: this.config.environment,
        }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    requireThat(
      response.ok,
      "WORLD_VERIFY_FAILED",
      "World proof verification failed.",
      403,
    );
    const result = await response.json();
    requireThat(
      result.success === true &&
        result.environment === this.config.environment &&
        result.action === this.config.action &&
        Array.isArray(result.results) &&
        result.results.some(
          (r) =>
            r.success === true &&
            r.identifier === item.identifier &&
            normalizeField(r.nullifier) === nullifier,
        ),
      "WORLD_VERIFY_FAILED",
      "World did not confirm the required credential.",
      403,
    );
    return this.store.tx(() => {
      const latest = this.store.db
        .prepare("SELECT * FROM challenges WHERE id=?")
        .get(c.id);
      requireThat(
        latest && !latest.used && latest.expires_at > this.clock(),
        "WORLD_CHALLENGE",
        "Verification challenge expired or was already consumed.",
        409,
      );
      const owner = this.store.get("world_owner");
      if (c.purpose === "enroll") {
        requireThat(
          !owner,
          "ALREADY_ENROLLED",
          "Owner is already enrolled.",
          409,
        );
        this.store.set("world_owner", {
          nullifier,
          rpId: this.config.rpId,
          action: this.config.action,
          environment: this.config.environment,
          verifiedAt: iso(this.clock()),
        });
      } else {
        requireThat(
          owner &&
            owner.nullifier === nullifier &&
            owner.rpId === this.config.rpId &&
            owner.action === this.config.action &&
            owner.environment === this.config.environment,
          "WRONG_OWNER",
          "Approval must come from the enrolled owner.",
          403,
        );
        const op = this.store.op(c.operation_id);
        this.engine.approve(c.operation_id, {
          verified: true,
          actionDigest: op?.actionDigest,
        });
      }
      this.store.db
        .prepare("UPDATE challenges SET used=1 WHERE id=?")
        .run(c.id);
      this.store.audit(
        "world." + c.purpose,
        c.operation_id || "owner",
        { environment: this.config.environment },
        this.clock(),
      );
      return {
        verified: true,
        purpose: c.purpose,
        operationId: c.operation_id,
      };
    });
  }
}
