import { Store } from "../src/store.mjs";
import { WalletEngine } from "../src/engine.mjs";
import { DemoAdapter } from "../src/adapters/demo.mjs";
import { loadConfig } from "../src/config.mjs";
const config = loadConfig({});
const store = new Store();
const engine = new WalletEngine({ store, config, adapter: new DemoAdapter() });
const agent = store.createAgent("demo-research");
async function prepare(service) {
  return engine.prepare(agent.id, {
    service_id: service,
    input: {},
    idempotency_key: crypto.randomUUID(),
  });
}
try {
  console.log(
    "World Agent Wallet — local simulation. No money is transferred.",
  );
  const small = await prepare("market-snapshot");
  const first = await engine.execute(agent.id, small.id);
  console.log("1. Automatic payment:", first.status, first.amount, "USDC");
  const large = await prepare("bess-analysis");
  console.log("2. Larger request:", large.status);
  engine.approve(large.id, { actionDigest: large.actionDigest });
  const approved = await engine.execute(agent.id, large.id);
  console.log(
    "3. Operator-approved execution:",
    approved.status,
    approved.amount,
    "USDC",
  );
  const replay = await engine.execute(agent.id, large.id);
  console.log(
    "4. Replay uses the same receipt:",
    replay.settlement.reference === approved.settlement.reference,
  );
  try {
    await prepare("deep-review");
  } catch (error) {
    console.log("5. Excessive request blocked:", error.code);
  }
  const pending = await prepare("market-snapshot");
  engine.revoke(agent.id);
  try {
    await engine.execute(agent.id, pending.id);
  } catch (error) {
    console.log("6. Revoked agent blocked:", error.code);
  }
  console.log("Final shared budget:", JSON.stringify(engine.budget(), null, 2));
} finally {
  store.close();
}
