# Security model

This is a local single-owner MVP, not an audited custody product. Report problems through a private channel to the repository owner; do not publish wallet secrets or exploit data containing user credentials.

## Trust boundaries

- The agent can request catalog services and execute already-authorized operations.
- The operator token can change budgets, create/revoke agent tokens and perform operator actions.
- World ID proves a human credential; the application separately binds approvals to the enrolled owner and exact operation.
- The gateway host, filesystem, dependencies, operator browser and wallet private key are trusted.
- A malicious agent with shell access to the gateway account can read local credential files. For actual isolation, run the gateway separately and provide the agent only its bearer token.

## Enforced invariants

- No raw transfer, arbitrary contract, unrestricted fetch, policy-editing or approval tool is exposed to MCP.
- Server-defined prices/quotes; decimal string parsing into integer millionths.
- Atomic reservations across all agents; no approval can override the daily cap.
- Idempotency binds the agent and normalized input. Single execution claim prevents parallel duplicate payment.
- Amount, recipient, network, token, catalog, input, expiry and policy revision are bound before approval/execution.
- The World proof's issuer/schema, environment, nonce, action, signal, successful verification result and enrolled owner are checked.
- Lost responses and process restarts keep funds reserved. No automatic resend of a payment authorization.
- Live endpoints use an operator allowlist, private-IP checks during DNS connection, no redirects, fixed GET method and bounded response bodies.
- Provider settlement is checked against the chain's Transfer and AuthorizationUsed logs.
- Operator actions need a separate token; origin/host validation and CSP are enabled; tokens are not stored in code or returned by read APIs.

## Remaining limitations

- Revocation prevents future claims; it cannot cancel a payment already authorized and transmitted.
- A completed operation is not reexecuted, but the free provider access during concurrent quote preparation may consume more than one free request.
- The DB records complete provider results and operational inputs locally. Apply your own retention/access policies before using sensitive data.
- The server keeps the signer key in memory and relies on OS isolation, rather than an HSM or smart-account session-key module.
- One L2 confirmation is accepted; finality and reorg recovery are not implemented.
- The root operator token has broad authority. Stronger human authentication for policy changes, recovery and token rotation are future work.
- Do not expose this loopback HTTP server directly to the internet. Remote access needs a properly configured TLS/authentication deployment and adjusted host/origin rules.

## Credential hygiene

Commit `.env.example` only. `.env`, `.local*/`, SQLite files and generated credentials are ignored. Use dedicated low-balance wallets for testing; never use a primary wallet's key. If a secret is exposed, rotate/revoke it and move funds as appropriate. Deleting a Git commit does not revoke a credential.
