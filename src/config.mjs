import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { money, requireThat } from "./utils.mjs";

export const demoServices = [
  {
    id: "market-snapshot",
    name: "Market snapshot",
    description: "Synthetic energy-market data for a paid-tool demo.",
    price: "0.2",
    kind: "demo",
    input: "empty",
  },
  {
    id: "bess-analysis",
    name: "BESS strategy check",
    description:
      "Constraint-aware illustrative BESS analysis. Not a dispatch optimizer.",
    price: "2",
    kind: "demo",
    input: "bess",
  },
  {
    id: "deep-review",
    name: "Extended review",
    description: "A 6 USDC sample to exercise the shared daily limit.",
    price: "6",
    kind: "demo",
    input: "empty",
  },
];
const serviceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    price: z.string(),
    kind: z.enum(["demo", "x402"]),
    input: z.enum(["empty", "bess"]),
    url: z.string().url().optional(),
    payTo: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .strict();
export const bessSchema = z
  .object({
    power_mw: z.number().positive().max(10000).default(100),
    energy_mwh: z.number().positive().max(100000).default(200),
    soc: z.number().min(0).max(1).default(0.62),
    soh: z.number().positive().max(1).default(0.96),
    min_soc: z.number().min(0).max(1).default(0.15),
    max_soc: z.number().min(0).max(1).default(0.9),
    horizon_hours: z.number().positive().max(24).default(1),
    price_usd_mwh: z.number().min(-10000).max(100000).default(95),
  })
  .strict()
  .refine(
    (x) => x.min_soc < x.max_soc && x.soc >= x.min_soc && x.soc <= x.max_soc,
    "SOC must be within the configured operating limits.",
  );
export function validateInput(service, input = {}) {
  return (service.input === "bess" ? bessSchema : z.object({}).strict()).parse(
    input,
  );
}
export function loadConfig(env = process.env) {
  const mode = env.WALLET_MODE || "demo";
  requireThat(
    ["demo", "x402"].includes(mode),
    "CONFIG",
    "WALLET_MODE must be demo or x402.",
  );
  const timezone = env.WALLET_TIMEZONE || "Asia/Seoul";
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  const port = Number(env.WALLET_PORT || 8787);
  requireThat(
    Number.isInteger(port) && port >= 0 && port < 65536,
    "CONFIG",
    "Invalid port.",
  );
  const services = (
    env.WALLET_SERVICES_FILE
      ? JSON.parse(readFileSync(resolve(env.WALLET_SERVICES_FILE), "utf8"))
      : demoServices
  ).map((s) => {
    const v = serviceSchema.parse(s);
    requireThat(
      money(v.price) > 0,
      "CONFIG",
      "Service prices must be greater than zero.",
    );
    requireThat(
      v.kind === mode,
      "CONFIG",
      "Catalog kind must match WALLET_MODE.",
    );
    if (v.kind === "x402") {
      requireThat(
        v.url && v.payTo && v.input === "empty",
        "CONFIG",
        "Live services need an exact HTTPS URL, recipient, and empty input.",
      );
      requireThat(
        !/^0x0{40}$/i.test(v.payTo),
        "CONFIG",
        "Replace the placeholder recipient before enabling live mode.",
      );
      const u = new URL(v.url);
      requireThat(
        u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.hash &&
          !u.port,
        "CONFIG",
        "Live endpoints must use HTTPS on port 443 without credentials or fragments.",
      );
    }
    return { ...v, maxMicros: money(v.price) };
  });
  requireThat(
    new Set(services.map((x) => x.id)).size === services.length,
    "CONFIG",
    "Duplicate service ID.",
  );
  const world = {
    appId: env.WORLD_APP_ID,
    rpId: env.WORLD_RP_ID,
    signingKey: env.WORLD_SIGNING_KEY,
    action: env.WORLD_ACTION || "agent-wallet-owner",
    environment: env.WORLD_ENVIRONMENT || "staging",
  };
  requireThat(
    ["production", "staging"].includes(world.environment),
    "CONFIG",
    "World environment must be production or staging.",
  );
  if (mode === "x402") {
    requireThat(
      env.WALLET_SERVICES_FILE &&
        /^0x[0-9a-fA-F]{64}$/.test(env.WORLD_WALLET_PRIVATE_KEY || ""),
      "CONFIG",
      "Live mode needs a catalog and a dedicated wallet private key.",
    );
    requireThat(
      world.appId &&
        world.rpId &&
        world.signingKey &&
        world.environment === "production",
      "CONFIG",
      "Live payments require production World ID configuration.",
    );
  }
  return {
    mode,
    port,
    timezone,
    services,
    world,
    dataDir: resolve(env.WALLET_DATA_DIR || ".local"),
    privateKey: env.WORLD_WALLET_PRIVATE_KEY,
    rpcUrl: env.WORLD_RPC_URL,
  };
}
