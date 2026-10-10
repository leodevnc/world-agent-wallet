import { join } from "node:path";
import { loadConfig } from "./config.mjs";
import { Store } from "./store.mjs";
import { initialize } from "./setup.mjs";
import { WalletEngine } from "./engine.mjs";
import { DemoAdapter } from "./adapters/demo.mjs";
import { WorldIdentity } from "./adapters/world-id.mjs";
import { createWalletServer } from "./http.mjs";
import { acquireGatewayLock } from "./lock.mjs";

const config = loadConfig();
const releaseLock = acquireGatewayLock(config.dataDir);
process.on("exit", releaseLock);
const store = new Store(join(config.dataDir, "wallet.sqlite"), config);
const { adminPath } = initialize(store, config);
const adapter =
  config.mode === "demo"
    ? new DemoAdapter()
    : new (await import("./adapters/x402.mjs")).X402Adapter(config);
const engine = new WalletEngine({ store, config, adapter });
const identity = new WorldIdentity({ store, engine, config: config.world });
const server = createWalletServer({ engine, identity, store, config });
server.on("error", (error) => {
  console.error("Gateway could not start:", error.code || error.name);
  store.close();
  process.exit(1);
});
server.listen(config.port, "127.0.0.1", () => {
  console.error(
    `World Agent Wallet · ${config.mode}\nDashboard: http://127.0.0.1:${server.address().port}\nOperator token file: ${adminPath}\nMCP agent credential: ${join(config.dataDir, "agent-research.json")}`,
  );
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
