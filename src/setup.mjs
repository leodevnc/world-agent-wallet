import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash, token, requireThat } from "./utils.mjs";

export function initialize(store, config) {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const adminPath = join(config.dataDir, "admin-token");
  if (!store.get("admin_token_hash")) {
    const secret = token();
    writeFileSync(adminPath, secret + "\n", { mode: 0o600 });
    store.set("admin_token_hash", hash(secret));
  }
  requireThat(
    existsSync(adminPath) &&
      hash(readFileSync(adminPath, "utf8").trim()) ===
        store.get("admin_token_hash"),
    "ADMIN_TOKEN",
    "Admin token file is missing or inconsistent with the database. Restore the original credential.",
  );
  if (!store.get("seeded")) {
    for (const name of ["research", "operations"]) {
      const agent = store.createAgent(name);
      writeFileSync(
        join(config.dataDir, `agent-${name}.json`),
        JSON.stringify(agent, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
    store.set("seeded", true);
  }
  return { adminPath };
}
