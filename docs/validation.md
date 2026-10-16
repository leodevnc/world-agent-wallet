# Validation record

## Neutral UI refresh — 2026-10-16

- `npm test`: 46 passed; `npm run test:e2e`: 3 passed.
- `npm run check` and `npm run build`: passed on Linux Node.js 24.19.0.
- Added assertions for neutral theme colors, keyboard skip navigation, visible mobile navigation and refresh, and the focusable activity table.
- Rechecked 320/390/768/1440px layouts and refreshed the desktop/mobile screenshots.
- Existing demo payment, approval, rejection and policy workflows still pass. No backend or adapter code changed.

See [ui-design.md](ui-design.md) for design decisions, tradeoffs and the limits of these checks.

## English-default update — 2026-10-16

Validated with Linux Node.js 24.19.0 and Playwright 1.63.0.

- English UI labels, accessibility names, status messages, README and integration instructions.
- English display-time locale; the budget's Asia/Seoul date boundary and user-provided names remain unchanged.
- `npm run check`, `npm run build` and `npm run demo`: passed.
- `npm test`: 46 passed, including English-default and original-language name regression checks.
- `npm run test:e2e`: 2 passed. Covers operator sign-in, simulated automatic payment, approval, rejection, request details, policy feedback and sign-out.
- Browser layouts checked at 320, 390, 768 and 1440 pixels without document overflow. The activity table retains horizontal scrolling on narrow screens.
- Updated `dashboard.png` and `dashboard-mobile.png` show the English interface with a pending demo approval.
- The main browser workflow observed no page errors or external requests. Non-loopback browser requests were blocked. Tests use an in-memory demo ledger and temporary test credentials, never actual account credentials or funds.

Reproduce browser checks after `npm ci` and `npm run build`:

```bash
npx playwright install chromium
npm run test:e2e
```

Linux browser runners need Chromium's system libraries. The tests start their own loopback server on an available port; no running gateway or environment file is needed. English defaults do not claim full localization or accessibility compliance. Live World ID and settlement validation remain outside this update.

## Initial validation — 2026-10-10

Validated on 2026-10-10 using Node.js 24.19.0.

| Check                | Result                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript syntax    | All source, script, browser and test modules passed                                                                                                         |
| Automated tests      | **44 passed, 0 failed**                                                                                                                                     |
| MCP interoperability | Official SDK client launched stdio server, discovered 6 tools, executed a small request, waited for human approval, resumed and retrieved original receipts |
| Budget concurrency   | 26 simultaneous 0.2 USDC requests across two agents produced 25 allowed executions and one limit rejection at a 5 USDC cap                                  |
| World ID adapter     | Simulated verifier responses covered owner enrollment, matching-owner approval, replay, wrong signal/nonce/action/environment and unsuccessful verification |
| AgentKit adapter     | Actual SDK signed a scoped challenge; a cross-origin challenge was rejected before payment fallback                                                         |
| x402 adapter         | Actual SDK generated an EIP-3009 signature; fixture RPC logs validated matching Transfer and AuthorizationUsed nonce                                        |
| Failure behavior     | Unknown payment outcomes retain the reservation; duplicate execution and restart do not resend                                                              |
| Build                | IDKit browser bundle generated successfully                                                                                                                 |
| Browser workflow     | Operator login → automatic demo payment → approval request → owner approval → 2.20 USDC committed                                                           |
| Browser errors       | No uncaught JavaScript errors in the tested workflow                                                                                                        |
| Desktop              | 1440 px viewport inspected; screenshot in `dashboard.png`                                                                                                   |
| Mobile               | 390 px viewport, document width 390 px; screenshot in `dashboard-mobile.png`                                                                                |
| Dependency audit     | `npm audit --omit=dev`: 0 reported vulnerabilities at validation time                                                                                       |
| Local demo           | Completed automatic payment, approval, idempotent receipt, daily-limit rejection and revoked-agent rejection                                                |

The browser checks used a local Chromium process and a temporary demo database. A local Noto Sans KR font was supplied to the test browser for Korean rendering. No credentials are included in screenshots; no external service was paid.

## Not verified with live accounts

- World ID mobile app enrollment and approval with the owner's actual developer app.
- Real AgentBook registration for the owner's signing wallet.
- A public x402 provider, an actual funded wallet, and real World Chain settlement.
- Ethereum L1 finality, reorg handling, custody-grade key storage, remote multi-user deployment and load testing.

The first three require the owner's app/account configuration and explicitly authorized funding. The integration modules are implemented and exercised offline, but this record does not claim an end-to-end mainnet payment.
