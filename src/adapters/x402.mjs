import {
  createAgentkitClient,
  createAgentBookVerifier,
} from "@worldcoin/agentkit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, decodeEventLog, http, parseAbi } from "viem";
import { worldchain } from "viem/chains";
import { parseSiweMessage } from "viem/siwe";
import { requireThat, formatMoney } from "../utils.mjs";
import { endpointFetch, readBoundedJson } from "./network.mjs";

export const WORLD_NETWORK = "eip155:480";
export const WORLD_USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
export function validatedRequirement(required, service) {
  requireThat(
    required?.x402Version === 2 &&
      required.resource?.url === service.url &&
      Array.isArray(required.accepts),
    "X402_QUOTE",
    "Expected x402 v2 for the exact catalog resource.",
  );
  const r = required.accepts.find(
    (r) =>
      r.scheme === "exact" &&
      r.network === WORLD_NETWORK &&
      typeof r.asset === "string" &&
      r.asset.toLowerCase() === WORLD_USDC.toLowerCase() &&
      typeof r.payTo === "string" &&
      r.payTo.toLowerCase() === service.payTo.toLowerCase(),
  );
  requireThat(
    r &&
      typeof r.amount === "string" &&
      /^[1-9]\d{0,11}$/.test(r.amount) &&
      Number(r.amount) <= service.maxMicros,
    "X402_QUOTE",
    "No allowed USDC quote within the catalog price ceiling.",
  );
  requireThat(
    Number.isInteger(r.maxTimeoutSeconds) &&
      r.maxTimeoutSeconds > 0 &&
      r.maxTimeoutSeconds <= 300,
    "X402_QUOTE",
    "Payment authorization lifetime must be 1–300 seconds.",
  );
  requireThat(
    r.extra?.name === "USD Coin" &&
      r.extra?.version === "2" &&
      (!r.extra.assetTransferMethod ||
        r.extra.assetTransferMethod === "eip3009"),
    "X402_QUOTE",
    "Only the fixed USDC EIP-3009 signing domain is supported.",
  );
  return {
    scheme: "exact",
    network: WORLD_NETWORK,
    asset: WORLD_USDC,
    amount: r.amount,
    payTo: service.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
  };
}
export class X402Adapter {
  constructor(config, overrides = {}) {
    this.account = privateKeyToAccount(config.privateKey);
    this.rpc = createPublicClient({
      chain: worldchain,
      transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 0 }),
    });
    this.agentBook = createAgentBookVerifier({ client: this.rpc });
    this.networkFactory = endpointFetch;
    Object.assign(this, overrides);
  }
  async quote(service) {
    const human = await this.agentBook.lookupHuman(this.account.address);
    requireThat(
      human,
      "AGENTBOOK_UNAVAILABLE",
      "The signing wallet is not registered in AgentBook, or its World Chain lookup failed.",
    );
    const network = this.networkFactory(service.url);
    try {
      let authRejected = false;
      const agentkit = createAgentkitClient({
        signer: {
          address: this.account.address,
          chainId: WORLD_NETWORK,
          type: "eip191",
          signMessage: (message) => {
            const siwe = parseSiweMessage(message);
            const now = Date.now();
            requireThat(
              siwe.domain === new URL(service.url).host &&
                siwe.uri === service.url &&
                siwe.address?.toLowerCase() ===
                  this.account.address.toLowerCase() &&
                siwe.chainId === 480 &&
                siwe.version === "1" &&
                siwe.issuedAt &&
                Math.abs(now - siwe.issuedAt.getTime()) < 300_000 &&
                siwe.expirationTime &&
                siwe.expirationTime.getTime() > now &&
                siwe.expirationTime.getTime() - now <= 300_000 &&
                (!siwe.resources ||
                  siwe.resources.every((resource) => resource === service.url)),
              "AGENTKIT_SCOPE",
              "AgentKit authentication challenge is outside the approved origin, resource, or lifetime.",
            );
            return this.account.signMessage({ message });
          },
        },
        fetch: network.fetch,
        onEvent: (event) => {
          if (event.type === "agentkit_skipped") authRejected = true;
        },
      });
      const response = await agentkit.fetch(service.url);
      requireThat(
        !authRejected,
        "AGENTKIT_SCOPE",
        "AgentKit authentication challenge was rejected; payment fallback is disabled.",
      );
      if (response.ok)
        return {
          amountMicros: 0,
          freeData: await readBoundedJson(response),
          network: WORLD_NETWORK,
          provider: "agentkit_free_access",
        };
      requireThat(
        response.status === 402,
        "PROVIDER_ERROR",
        "Provider did not return data or an x402 quote.",
      );
      const header = response.headers.get("payment-required");
      requireThat(
        header && header.length < 32768,
        "X402_QUOTE",
        "Missing or oversized payment-required header.",
      );
      const required = decodePaymentRequiredHeader(header);
      const requirement = validatedRequirement(required, service);
      await response.body?.cancel();
      return {
        amountMicros: Number(requirement.amount),
        requirement,
        network: WORLD_NETWORK,
        recipient: requirement.payTo,
        provider: service.url,
      };
    } finally {
      await network.close();
    }
  }
  async execute(op, service) {
    if (op.amountMicros === 0)
      return {
        amountMicros: 0,
        data: op.quote.freeData,
        settlement: { status: "free_access", network: WORLD_NETWORK },
      };
    let sent = false;
    let network;
    try {
      const required = {
        x402Version: 2,
        resource: { url: service.url },
        accepts: [op.quote.requirement],
      };
      const requirement = validatedRequirement(required, service);
      requireThat(
        Number(requirement.amount) === op.amountMicros,
        "X402_QUOTE",
        "Approved amount does not match the payment requirement.",
      );
      const client = new x402Client().register(
        WORLD_NETWORK,
        new ExactEvmScheme(this.account),
      );
      client.setSpendControls({
        maxAmountPerPayment: "$" + formatMoney(op.amountMicros),
        allowedAssets: [
          {
            network: WORLD_NETWORK,
            asset: WORLD_USDC,
            maxAmountPerPayment: String(op.amountMicros),
          },
        ],
      });
      const httpClient = new x402HTTPClient(client);
      const payload = await httpClient.createPaymentPayload(required);
      const auth = payload.payload.authorization;
      requireThat(
        auth &&
          auth.from?.toLowerCase() === this.account.address.toLowerCase() &&
          auth.to?.toLowerCase() === service.payTo.toLowerCase() &&
          BigInt(auth.value) === BigInt(op.amountMicros),
        "SIGNATURE_SCOPE",
        "Payment authorization escaped the approved scope.",
      );
      network = this.networkFactory(service.url);
      sent = true;
      const response = await network.fetch(service.url, {
        headers: {
          ...httpClient.encodePaymentSignatureHeader(payload),
          accept: "application/json",
          "idempotency-key": op.id,
        },
      });
      const header = response.headers.get("payment-response");
      requireThat(
        response.ok && header && header.length < 32768,
        "SETTLEMENT_UNKNOWN",
        "Provider did not confirm payment and return data.",
      );
      const settlement = decodePaymentResponseHeader(header);
      requireThat(
        settlement.success === true &&
          settlement.network === WORLD_NETWORK &&
          /^0x[0-9a-fA-F]{64}$/.test(settlement.transaction || ""),
        "SETTLEMENT_UNKNOWN",
        "Provider settlement could not be verified.",
      );
      const data = await readBoundedJson(response);
      const receipt = await this.rpc.waitForTransactionReceipt({
        hash: settlement.transaction,
        timeout: 15_000,
        confirmations: 1,
      });
      const abi = parseAbi([
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
      ]);
      const events = receipt.logs
        .filter((log) => log.address.toLowerCase() === WORLD_USDC.toLowerCase())
        .flatMap((log) => {
          try {
            return [
              decodeEventLog({ abi, data: log.data, topics: log.topics }),
            ];
          } catch {
            return [];
          }
        });
      const hasTransfer = events.some(
        (e) =>
          e.eventName === "Transfer" &&
          e.args.from.toLowerCase() === this.account.address.toLowerCase() &&
          e.args.to.toLowerCase() === service.payTo.toLowerCase() &&
          e.args.value === BigInt(op.amountMicros),
      );
      const hasNonce = events.some(
        (e) =>
          e.eventName === "AuthorizationUsed" &&
          e.args.authorizer.toLowerCase() ===
            this.account.address.toLowerCase() &&
          e.args.nonce.toLowerCase() === auth.nonce.toLowerCase(),
      );
      requireThat(
        receipt.status === "success" && hasTransfer && hasNonce,
        "SETTLEMENT_UNKNOWN",
        "World Chain receipt did not prove this exact transfer and authorization nonce.",
      );
      return {
        amountMicros: op.amountMicros,
        data,
        settlement: {
          status: "confirmed_on_l2",
          network: WORLD_NETWORK,
          transaction: settlement.transaction,
          confirmations: 1,
        },
      };
    } catch (error) {
      if (!sent) error.definitelyUnsent = true;
      throw error;
    } finally {
      if (network) await network.close();
    }
  }
}
