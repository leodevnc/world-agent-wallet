import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateInput } from "./config.mjs";
import {
  digest,
  requireThat,
  WalletError,
  dayKey,
  iso,
  money,
  formatMoney,
} from "./utils.mjs";

export class WalletEngine {
  constructor({ store, config, adapter, clock = Date.now }) {
    Object.assign(this, { store, config, adapter, clock });
    // A restart cannot tell whether an interrupted payment reached the provider.
    for (const { id } of store.db
      .prepare("SELECT id FROM operations WHERE status='executing'")
      .all()) {
      const op = store.op(id);
      op.status = "uncertain";
      op.error =
        "Server restarted during execution; payment will not be retried.";
      store.save(op);
    }
  }
  active(agentId) {
    const agent = this.store.agent(agentId);
    requireThat(
      agent && !agent.revoked,
      "AGENT_REVOKED",
      "Agent is missing or revoked.",
      403,
    );
    return agent;
  }
  service(id) {
    const service = this.config.services.find((s) => s.id === id);
    requireThat(
      service,
      "SERVICE_NOT_ALLOWED",
      "Service is not in the operator-approved catalog.",
      403,
    );
    return service;
  }
  budget() {
    const policy = this.store.get("policy");
    const day = dayKey(this.clock(), this.config.timezone);
    const committed = this.store.committed(day);
    return {
      day,
      timezone: this.config.timezone,
      dailyLimit: formatMoney(policy.dailyMicros),
      autoLimit: formatMoney(policy.autoMicros),
      committed: formatMoney(committed),
      remaining: formatMoney(Math.max(0, policy.dailyMicros - committed)),
      revision: policy.revision,
      currency: "USDC",
      mode: this.config.mode,
    };
  }
  publicOp(op) {
    if (!op) return null;
    const { quote, ...visible } = op;
    return {
      ...visible,
      amount: formatMoney(op.amountMicros),
      currency: "USDC",
      mode: this.config.mode,
    };
  }
  get(agentId, id) {
    this.active(agentId);
    const op = this.store.op(id);
    requireThat(
      op && op.agentId === agentId,
      "NOT_FOUND",
      "Operation not found.",
      404,
    );
    return this.publicOp(op);
  }
  async prepare(agentId, args) {
    this.active(agentId);
    const parsed = z
      .object({
        service_id: z.string(),
        input: z.record(z.string(), z.unknown()).default({}),
        idempotency_key: z.string().regex(/^[a-zA-Z0-9:_-]{8,128}$/),
      })
      .strict()
      .parse(args);
    const service = this.service(parsed.service_id);
    const input = validateInput(service, parsed.input);
    const fingerprint = digest({ service: service.id, input });
    const previous = this.store.byKey(agentId, parsed.idempotency_key);
    if (previous) {
      requireThat(
        previous.fingerprint === fingerprint,
        "IDEMPOTENCY_CONFLICT",
        "This idempotency key belongs to a different request.",
        409,
      );
      return this.publicOp(previous);
    }
    if (this.config.mode === "x402")
      requireThat(
        this.store.get("world_owner"),
        "WORLD_VERIFICATION_REQUIRED",
        "The operator must enroll a production World ID before live requests.",
        403,
      );
    const quote = await this.adapter.quote(service, input);
    requireThat(
      Number.isSafeInteger(quote.amountMicros) &&
        quote.amountMicros >= 0 &&
        quote.amountMicros <= service.maxMicros,
      "PRICE_LIMIT",
      "Provider quote exceeds the catalog ceiling.",
    );
    return this.store.tx(() => {
      this.active(agentId);
      const race = this.store.byKey(agentId, parsed.idempotency_key);
      if (race) {
        requireThat(
          race.fingerprint === fingerprint,
          "IDEMPOTENCY_CONFLICT",
          "Conflicting idempotency key.",
          409,
        );
        return this.publicOp(race);
      }
      const policy = this.store.get("policy");
      const now = this.clock();
      requireThat(
        quote.amountMicros <= policy.dailyMicros,
        "DAILY_LIMIT",
        "This operation alone exceeds the daily budget.",
        403,
      );
      const operation = {
        id: randomUUID(),
        agentId,
        idempotencyKey: parsed.idempotency_key,
        fingerprint,
        serviceId: service.id,
        serviceName: service.name,
        serviceDigest: digest(service),
        input,
        amountMicros: quote.amountMicros,
        quote,
        status:
          quote.amountMicros > policy.autoMicros
            ? "awaiting_approval"
            : "ready",
        createdAt: iso(now),
        expiresAt: now + 5 * 60_000,
        policyRevision: policy.revision,
      };
      operation.actionDigest = digest({
        id: operation.id,
        agentId,
        service: operation.serviceDigest,
        input,
        quote,
        expiresAt: operation.expiresAt,
        revision: policy.revision,
      });
      this.store.save(operation);
      this.store.audit(
        "operation.prepared",
        operation.id,
        { agentId, amountMicros: quote.amountMicros },
        now,
      );
      return this.publicOp(operation);
    });
  }
  approve(id, { verified = false, actionDigest } = {}) {
    return this.store.tx(() => {
      const op = this.store.op(id);
      requireThat(
        op && op.status === "awaiting_approval",
        "INVALID_STATE",
        "Operation is not awaiting approval.",
        409,
      );
      requireThat(
        actionDigest === op.actionDigest,
        "APPROVAL_MISMATCH",
        "Approval is not bound to this operation.",
        403,
      );
      this.checkFresh(op);
      this.active(op.agentId);
      if (this.config.mode === "x402" || this.store.get("world_owner"))
        requireThat(
          verified,
          "WORLD_VERIFICATION_REQUIRED",
          "This approval requires the enrolled World ID.",
          403,
        );
      op.status = "ready";
      op.approved = {
        at: iso(this.clock()),
        method: verified ? "world_id" : "demo_operator",
        actionDigest,
      };
      this.store.save(op);
      this.store.audit(
        "operation.approved",
        id,
        { method: op.approved.method },
        this.clock(),
      );
      return this.publicOp(op);
    });
  }
  checkFresh(op) {
    requireThat(
      this.clock() < op.expiresAt,
      "EXPIRED",
      "Quote/approval expired. Prepare a new operation with a new idempotency key.",
      409,
    );
    requireThat(
      this.store.get("policy").revision === op.policyRevision,
      "POLICY_CHANGED",
      "Policy changed. Prepare a new operation.",
      409,
    );
    requireThat(
      digest(this.service(op.serviceId)) === op.serviceDigest,
      "CATALOG_CHANGED",
      "Service configuration changed. Prepare a new operation.",
      409,
    );
  }
  reject(id) {
    return this.store.tx(() => {
      const op = this.store.op(id);
      requireThat(
        op && ["awaiting_approval", "ready"].includes(op.status),
        "INVALID_STATE",
        "Operation can no longer be rejected.",
        409,
      );
      op.status = "rejected";
      this.store.save(op);
      this.store.audit("operation.rejected", id, {}, this.clock());
      return this.publicOp(op);
    });
  }
  async execute(agentId, id) {
    let operation;
    let cached;
    this.store.tx(() => {
      this.active(agentId);
      const op = this.store.op(id);
      requireThat(
        op && op.agentId === agentId,
        "NOT_FOUND",
        "Operation not found.",
        404,
      );
      if (["succeeded", "charged_unconfirmed"].includes(op.status)) {
        cached = this.publicOp(op);
        return;
      }
      requireThat(
        op.status === "ready",
        op.status === "awaiting_approval"
          ? "APPROVAL_REQUIRED"
          : "INVALID_STATE",
        `Operation is ${op.status}; no payment was retried.`,
        409,
      );
      this.checkFresh(op);
      const policy = this.store.get("policy");
      if (op.amountMicros > policy.autoMicros)
        requireThat(
          op.approved?.actionDigest === op.actionDigest,
          "APPROVAL_REQUIRED",
          "Matching approval is required.",
          403,
        );
      if (this.config.mode === "x402") {
        requireThat(
          this.store.get("world_owner"),
          "WORLD_VERIFICATION_REQUIRED",
          "Owner verification required.",
          403,
        );
        requireThat(
          !this.store.db
            .prepare(
              "SELECT id FROM operations WHERE status='uncertain' LIMIT 1",
            )
            .get(),
          "RECONCILIATION_REQUIRED",
          "Review the unresolved payment before authorizing more live spending.",
          409,
        );
      }
      const day = dayKey(this.clock(), this.config.timezone);
      requireThat(
        this.store.committed(day) + op.amountMicros <= policy.dailyMicros,
        "DAILY_LIMIT",
        "Shared daily budget is exhausted. Human approval cannot bypass it.",
        403,
      );
      op.status = "executing";
      op.reservedDay = day;
      op.startedAt = iso(this.clock());
      this.store.save(op);
      this.store.audit(
        "payment.reserved",
        id,
        { day, amountMicros: op.amountMicros },
        this.clock(),
      );
      operation = op;
    });
    if (cached) return cached;
    try {
      const result = await this.adapter.execute(
        operation,
        this.service(operation.serviceId),
      );
      requireThat(
        Number.isSafeInteger(result.amountMicros) &&
          result.amountMicros >= 0 &&
          result.amountMicros <= operation.amountMicros,
        "INVALID_SETTLEMENT",
        "Settlement exceeded the reserved amount.",
      );
      operation.status = "succeeded";
      operation.amountMicros = result.amountMicros;
      operation.result = result.data;
      operation.settlement = result.settlement;
      operation.completedAt = iso(this.clock());
      this.store.tx(() => {
        this.store.save(operation);
        this.store.audit(
          "payment.completed",
          id,
          { amountMicros: result.amountMicros, settlement: result.settlement },
          this.clock(),
        );
      });
    } catch (error) {
      // A network timeout is not evidence that payment failed. Keep the reservation.
      operation.status =
        error.definitelyUnsent === true ? "failed" : "uncertain";
      operation.error =
        error instanceof WalletError
          ? error.message
          : "Execution outcome is unknown; no automatic retry. See the operator dashboard.";
      this.store.tx(() => {
        this.store.save(operation);
        this.store.audit(
          "payment." + operation.status,
          id,
          { code: error.code || "EXECUTION_ERROR" },
          this.clock(),
        );
      });
    }
    return this.publicOp(operation);
  }
  changePolicy({ daily_limit, auto_limit }) {
    const dailyMicros = money(daily_limit);
    const autoMicros = money(auto_limit);
    requireThat(
      dailyMicros > 0 && autoMicros <= dailyMicros,
      "INVALID_POLICY",
      "Auto limit must not exceed a positive daily limit.",
    );
    this.store.tx(() => {
      const revision = this.store.get("policy").revision + 1;
      this.store.set("policy", { dailyMicros, autoMicros, revision });
      this.store.audit(
        "policy.changed",
        "owner",
        { dailyMicros, autoMicros, revision },
        this.clock(),
      );
    });
    return this.budget();
  }
  revoke(id) {
    requireThat(this.store.agent(id), "NOT_FOUND", "Agent not found.", 404);
    this.store.tx(() => {
      this.store.db.prepare("UPDATE agents SET revoked=1 WHERE id=?").run(id);
      this.store.audit("agent.revoked", id, {}, this.clock());
    });
  }
  acknowledgeUncertain(id) {
    return this.store.tx(() => {
      const op = this.store.op(id);
      requireThat(
        op?.status === "uncertain",
        "INVALID_STATE",
        "Only uncertain payments can be acknowledged.",
        409,
      );
      op.status = "charged_unconfirmed";
      op.settlement = { status: "unconfirmed_counted_at_maximum" };
      this.store.save(op);
      this.store.audit("payment.counted_at_maximum", id, {}, this.clock());
      return this.publicOp(op);
    });
  }
}
