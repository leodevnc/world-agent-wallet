# World integration

## 1. Start with the local simulation

Complete `npm ci`, `npm run build`, `npm start`, and `npm test` first. The demo has no dependency on World accounts, an Orb, blockchain funds, or an LLM provider.

## 2. Enable World ID in demo mode

Create a World developer app, enable RP registration, and obtain the app ID, RP ID and RP signing key from the Developer Portal. Configure an action suitable for repeat approvals; a one-use action configuration is incompatible with repeated wallet approvals.

```dotenv
WALLET_MODE=demo
WORLD_APP_ID=app_replace_me
WORLD_RP_ID=rp_replace_me
WORLD_SIGNING_KEY=0x_replace_me
WORLD_ACTION=agent-wallet-owner
WORLD_ENVIRONMENT=staging
```

Restart the gateway. Click **Connect World ID**, then open the generated link in the matching World ID environment. The browser uses IDKit 4's `ProofOfHuman` flow. Staging/sandbox app availability is controlled by World; the code supports `staging` and `production`, not sandbox proofs. Verification is performed by the official backend, not trusted from the browser callback.

After enrollment, approvals require that same verified human. The operator token remains mandatory. Environment, RP or action changes require restoring the original configuration or using a fresh data directory.

## 3. Prepare a live deployment

Use a separate data directory, a **dedicated** low-balance wallet, production World ID credentials and a provider that supports this adapter's exact x402 scope.

```dotenv
WALLET_MODE=x402
WALLET_DATA_DIR=.local-live
WORLD_ENVIRONMENT=production
WORLD_APP_ID=app_replace_me
WORLD_RP_ID=rp_replace_me
WORLD_SIGNING_KEY=0x_replace_me
WORLD_ACTION=agent-wallet-owner
WORLD_WALLET_PRIVATE_KEY=0x_replace_me
WORLD_RPC_URL=https://worldchain-mainnet.g.alchemy.com/public
WALLET_SERVICES_FILE=./services.live.json
```

Keep `.local-live/` outside Git as well; the default ignore rule covers `.local*/`. Never pass private keys in MCP tool arguments, prompts, client config, browser JavaScript, or screenshots.

Register the signing wallet using World's official CLI:

```bash
npx @worldcoin/agentkit-cli register <wallet-address>
npx @worldcoin/agentkit-cli status <wallet-address>
```

The CLI requests human verification. The plugin checks canonical AgentBook registration at quote time. A missing entry or RPC failure blocks access; it never silently falls back to a paid request.

The app's World ID owner and AgentBook registration are independent scoped proofs. The plugin does not compare their identifiers. The authenticated operator is responsible for supplying the dedicated signing wallet it controls.

## 4. Configure the service catalog

Copy `examples/services.live.json` to `services.live.json`. Replace every placeholder with a real, trusted provider's details. The configured `price` is a **maximum**, not an instruction to trust any price returned by the provider.

Supported scope:

- HTTPS port 443 and a fixed GET URL, with no user-provided URL or headers.
- x402 v2 `exact` on World Chain, chain ID 480.
- USDC contract `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`.
- EIP-3009 with token name `USD Coin`, version `2`.
- Fixed recipient matching the catalog and a maximum authorization lifetime of 300 seconds.
- JSON data response, maximum 1 MiB.
- A `PAYMENT-RESPONSE` containing the transaction hash; matching Transfer and AuthorizationUsed events are then checked through the configured RPC.

An API using Permit2, another stablecoin, another chain, HTML or POST requires a new adapter and corresponding tests. AgentKit's client handles proof-of-human access; this plugin separately constructs the payment using the x402 SDK.

## 5. Validate with your actual account

Real World app interaction and public-chain settlement were not performed during MVP development. Before funding and enabling live use, validate the following in your environment:

1. Owner enrollment and same-person approval work with your RP/action settings.
2. A second person's approval is rejected.
3. Your wallet is registered in AgentBook and the selected API advertises a supported payment requirement.
4. A deliberately small authorized payment yields the expected chain receipt and API result.
5. Your API's free-trial behavior, failures and settlement timing match the adapter's assumptions.

World/x402 are evolving dependencies. Review version changes before upgrading the pinned lockfile. Single L2 confirmation is not L1 finality. The local gateway does not provide managed custody, multi-user SaaS authentication, or hardware-backed signing.
