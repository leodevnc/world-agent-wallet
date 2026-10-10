# Validation record

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
