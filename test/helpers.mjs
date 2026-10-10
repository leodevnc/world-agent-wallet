import { Store } from "../src/store.mjs";
import { WalletEngine } from "../src/engine.mjs";
import { DemoAdapter } from "../src/adapters/demo.mjs";
import { loadConfig } from "../src/config.mjs";
export function fixture(options = {}) {
  const config = { ...loadConfig({}), ...options.config };
  const store = new Store(options.path || ":memory:", config);
  let now = Date.parse("2026-10-10T10:00:00Z");
  const adapter = options.adapter || new DemoAdapter();
  const engine = new WalletEngine({ store, config, adapter, clock: () => now });
  const a = store.createAgent("research");
  const b = store.createAgent("operations");
  return {
    config,
    store,
    engine,
    adapter,
    a,
    b,
    setTime: (value) => {
      now = value;
    },
    clock: () => now,
  };
}
export const request = (
  service = "market-snapshot",
  key = crypto.randomUUID(),
  input = {},
) => ({ service_id: service, idempotency_key: key, input });
