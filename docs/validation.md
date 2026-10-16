# Testing and integration limits

## Run locally

Requires Node.js 24 or newer:

```bash
npm ci
npm run check
npm test
npm run build
npm run demo
npx playwright install chromium
npm run test:e2e
```

Linux browser runners need Chromium's system libraries. Browser tests start their own loopback server on an available port, use an in-memory demo ledger, and block non-loopback requests. No running gateway, environment file, actual account credentials, or funds are needed.

## Coverage

| Area | Test contract |
| --- | --- |
| MCP interoperability | Official SDK client starts the stdio server, discovers tools, executes a small request, resumes after approval, and retrieves the original receipt |
| Budget concurrency | 26 simultaneous 0.2 USDC requests across two agents admit 25 executions and reject one at a 5 USDC cap |
| World ID adapter | Simulated responses exercise enrollment, matching-owner approval, replay, wrong signal/nonce/action/environment, and unsuccessful verification |
| AgentKit adapter | SDK signs a scoped challenge; cross-origin challenges are rejected before payment fallback |
| x402 adapter | SDK produces an EIP-3009 signature; fixture RPC logs must match Transfer and AuthorizationUsed nonce |
| Failure behavior | Unknown outcomes retain their reservation; duplicate execution and restart must not resend payment |
| Browser workflow | Demo sign-in, payment, approval/rejection, request details, policy changes, and sign-out |
| Language and layout | Original-language names, keyboard navigation, a focusable activity table, and narrow-screen navigation |

The browser's activity table scrolls horizontally on narrow screens to preserve receipt columns. Layout and keyboard checks are targeted regressions, not a full accessibility audit.

## Not verified with live accounts

- World ID mobile app enrollment and approval with the owner's actual developer app.
- Real AgentBook registration for the owner's signing wallet.
- A public x402 provider, an actual funded wallet, and real World Chain settlement.
- Ethereum L1 finality, reorg handling, custody-grade key storage, remote multi-user deployment, and load testing.

The first three require the owner's app/account configuration and explicitly authorized funding. Offline adapter checks do not establish end-to-end mainnet payment correctness.
