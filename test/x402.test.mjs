import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  parseAbi,
} from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  X402Adapter,
  WORLD_NETWORK,
  WORLD_USDC,
  validatedRequirement,
} from "../src/adapters/x402.mjs";
import {
  isPublicAddress,
  endpointFetch,
  readBoundedJson,
  validateEndpointRequest,
} from "../src/adapters/network.mjs";

const service = {
  id: "example",
  url: "https://api.example.com/data",
  payTo: "0x1111111111111111111111111111111111111111",
  maxMicros: 2_000_000,
};
function required() {
  return {
    x402Version: 2,
    resource: { url: service.url },
    accepts: [
      {
        scheme: "exact",
        network: WORLD_NETWORK,
        asset: WORLD_USDC,
        payTo: service.payTo,
        amount: "2000000",
        maxTimeoutSeconds: 60,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}
test("quote validation pins chain, token, recipient, domain, timeout and price", () => {
  assert.equal(validatedRequirement(required(), service).amount, "2000000");
  for (const patch of [
    { network: "eip155:8453" },
    { asset: service.payTo },
    { payTo: WORLD_USDC },
    { amount: "3000000" },
    { amount: "2e6" },
    { maxTimeoutSeconds: 9999 },
    { extra: { name: "Attacker", version: "2" } },
    {
      extra: { name: "USD Coin", version: "2", assetTransferMethod: "permit2" },
    },
  ]) {
    const q = required();
    Object.assign(q.accepts[0], patch);
    assert.throws(() => validatedRequirement(q, service));
  }
  const q = required();
  q.resource.url = "https://evil.example";
  assert.throws(() => validatedRequirement(q, service));
});
test("network policy blocks loopback, metadata, private, multicast and mapped addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "172.20.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "0.0.0.0",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "http://api.example.com/data",
    "https://127.0.0.1/data",
    "https://a:b@example.com/data",
    "https://example.com:8443/data",
  ])
    assert.throws(() => endpointFetch(url));
});
test("oversized provider results are rejected", async () => {
  await assert.rejects(readBoundedJson(new Response("x".repeat(100)), 50), {
    code: "RESPONSE_TOO_LARGE",
  });
});
test("network accepts the Request objects used internally by AgentKit and retains its header", () => {
  const request = validateEndpointRequest(
    service.url,
    new Request(service.url, { headers: { agentkit: "signed-challenge" } }),
  );
  assert.equal(request.headers.get("agentkit"), "signed-challenge");
  assert.throws(
    () =>
      validateEndpointRequest(service.url, new Request("https://evil.example")),
    { code: "ENDPOINT" },
  );
  assert.throws(
    () =>
      validateEndpointRequest(
        service.url,
        new Request(service.url, { method: "POST" }),
      ),
    { code: "ENDPOINT" },
  );
});
test("AgentKit retries with a scoped wallet signature and refuses cross-origin signing challenges", async () => {
  async function run(domain) {
    let calls = 0,
      header;
    const q = required();
    q.extensions = {
      agentkit: {
        info: {
          domain,
          uri: service.url,
          version: "1",
          nonce: "nonce12345678",
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 60000).toISOString(),
        },
        supportedChains: [{ chainId: WORLD_NETWORK, type: "eip191" }],
        schema: {},
      },
    };
    const adapter = new X402Adapter(
      { privateKey: generatePrivateKey() },
      {
        agentBook: { lookupHuman: async () => "registered" },
        networkFactory: () => ({
          fetch: async (input) => {
            calls++;
            const req = new Request(input);
            header = req.headers.get("agentkit");
            return calls === 1
              ? Response.json(q, {
                  status: 402,
                  headers: {
                    "payment-required": encodePaymentRequiredHeader(q),
                  },
                })
              : Response.json({ free: true });
          },
          close: async () => {},
        }),
      },
    );
    const quote = await adapter.quote(service);
    return { calls, header, quote };
  }
  const good = await run("api.example.com");
  assert.equal(good.calls, 2);
  assert.ok(good.header);
  assert.equal(good.quote.amountMicros, 0);
  await assert.rejects(run("evil.example"), { code: "AGENTKIT_SCOPE" });
});
test("unregistered or unavailable AgentBook is fail-closed before accessing provider", async () => {
  const adapter = new X402Adapter(
    { privateKey: generatePrivateKey() },
    {
      agentBook: { lookupHuman: async () => null },
      networkFactory: () => {
        throw new Error("Should not access network");
      },
    },
  );
  await assert.rejects(adapter.quote(service), {
    code: "AGENTBOOK_UNAVAILABLE",
  });
});
test("x402 quote has no payment signature and does not pay", async () => {
  let calls = 0;
  const adapter = new X402Adapter(
    { privateKey: generatePrivateKey() },
    {
      agentBook: { lookupHuman: async () => "registered" },
      networkFactory: () => ({
        fetch: async (url, init) => {
          calls++;
          assert.equal(init?.headers?.["PAYMENT-SIGNATURE"], undefined);
          return new Response(null, {
            status: 402,
            headers: {
              "payment-required": encodePaymentRequiredHeader(required()),
            },
          });
        },
        close: async () => {},
      }),
    },
  );
  const q = await adapter.quote(service);
  assert.equal(q.amountMicros, 2_000_000);
  assert.equal(calls, 1);
});
test("free provider access is recorded with zero charge", async () => {
  const adapter = new X402Adapter(
    { privateKey: generatePrivateKey() },
    {
      agentBook: { lookupHuman: async () => "registered" },
      networkFactory: () => ({
        fetch: async () => Response.json({ source: "free" }),
        close: async () => {},
      }),
    },
  );
  const quote = await adapter.quote(service);
  const r = await adapter.execute({ amountMicros: 0, quote }, service);
  assert.equal(r.amountMicros, 0);
  assert.equal(r.data.source, "free");
});
test("actual x402 SDK signs only the approved amount and matching nonce is checked on chain", async () => {
  let payload;
  const tx = "0x" + "ab".repeat(32);
  const abi = parseAbi([
    "event Transfer(address indexed from,address indexed to,uint256 value)",
    "event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)",
  ]);
  const adapter = new X402Adapter(
    { privateKey: generatePrivateKey() },
    {
      networkFactory: () => ({
        fetch: async (url, init) => {
          const h = new Headers(init.headers);
          payload = decodePaymentSignatureHeader(h.get("payment-signature"));
          assert.equal(payload.accepted.amount, "2000000");
          assert.equal(
            payload.payload.authorization.to.toLowerCase(),
            service.payTo.toLowerCase(),
          );
          return Response.json(
            { answer: 42 },
            {
              headers: {
                "payment-response": encodePaymentResponseHeader({
                  success: true,
                  network: WORLD_NETWORK,
                  transaction: tx,
                  payer: payload.payload.authorization.from,
                }),
              },
            },
          );
        },
        close: async () => {},
      }),
      rpc: {
        waitForTransactionReceipt: async () => {
          const a = payload.payload.authorization;
          return {
            status: "success",
            logs: [
              {
                address: WORLD_USDC,
                topics: encodeEventTopics({
                  abi,
                  eventName: "Transfer",
                  args: { from: a.from, to: a.to },
                }),
                data: encodeAbiParameters(parseAbiParameters("uint256"), [
                  BigInt(a.value),
                ]),
              },
              {
                address: WORLD_USDC,
                topics: encodeEventTopics({
                  abi,
                  eventName: "AuthorizationUsed",
                  args: { authorizer: a.from, nonce: a.nonce },
                }),
                data: "0x",
              },
            ],
          };
        },
      },
    },
  );
  const op = {
    id: crypto.randomUUID(),
    amountMicros: 2_000_000,
    quote: { requirement: validatedRequirement(required(), service) },
  };
  const r = await adapter.execute(op, service);
  assert.equal(r.data.answer, 42);
  assert.equal(r.settlement.status, "confirmed_on_l2");
  assert.equal(r.settlement.transaction, tx);
});
test("lost paid response is not classified as definitely unsent", async () => {
  const adapter = new X402Adapter(
    { privateKey: generatePrivateKey() },
    {
      networkFactory: () => ({
        fetch: async () => {
          throw new Error("timeout");
        },
        close: async () => {},
      }),
    },
  );
  await assert.rejects(
    adapter.execute(
      {
        id: crypto.randomUUID(),
        amountMicros: 2_000_000,
        quote: { requirement: validatedRequirement(required(), service) },
      },
      service,
    ),
    (e) => e.message === "timeout" && e.definitelyUnsent !== true,
  );
});
