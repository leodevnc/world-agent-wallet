# Roadmap

## v0.1.0 — local MVP

- [x] Standard MCP stdio tools
- [x] Shared durable budget and policy revisions
- [x] Operator approval and revocation
- [x] World ID enrollment and bound approval adapter
- [x] AgentBook + x402 World Chain USDC adapter
- [x] Local demo, Korean dashboard and mobile layout
- [x] Unit and protocol integration tests, setup docs and CI definition

## Next milestone — verify a real integration

- [ ] Validate World ID app interaction with the owner's developer configuration
- [ ] Exercise a small user-authorized payment against a compatible live provider
- [ ] Add provider-specific fixtures from that integration
- [ ] Confirm the actual customer need with 3–5 agent developers

## Later, if validated

- Streamable HTTP MCP with OAuth for remote hosts
- Hardware/managed signer or smart-account scoped keys
- Per-agent budgets in addition to the owner's shared cap
- Multi-owner accounts, recovery and token rotation
- Strong authentication for policy changes
- More tool/settlement adapters and finality handling
- OpenTelemetry and operational alerting

No custom token, smart contract, LLM inference service, or marketplace is required for the current MVP.
