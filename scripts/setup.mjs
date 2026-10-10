import { join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { Store } from "../src/store.mjs";
import { initialize } from "../src/setup.mjs";
const config = loadConfig();
const store = new Store(join(config.dataDir, "wallet.sqlite"), config);
const { adminPath } = initialize(store, config);
store.close();
console.log(
  `Setup complete.\nOperator token: ${adminPath}\nAgent credential: ${join(config.dataDir, "agent-research.json")}\nRun npm start, then open http://127.0.0.1:${config.port}.`,
);
