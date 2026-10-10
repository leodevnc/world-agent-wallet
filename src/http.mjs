import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WalletError, hash, sameSecret, requireThat } from "./utils.mjs";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const files = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
  "/world-id.bundle.js": ["world-id.bundle.js", "text/javascript"],
};
async function body(req) {
  requireThat(
    (req.headers["content-type"] || "").startsWith("application/json"),
    "CONTENT_TYPE",
    "Use application/json.",
    415,
  );
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(
      size <= 128 * 1024,
      "BODY_TOO_LARGE",
      "Request body is too large.",
      413,
    );
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WalletError("INVALID_JSON", "Invalid JSON.");
  }
}
export function createWalletServer({ engine, identity, store, config }) {
  const send = (res, code, data) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.world.org https://*.worldcoin.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const port = server.address()?.port;
      const host = req.headers.host;
      requireThat(
        host === `127.0.0.1:${port}` || host === `localhost:${port}`,
        "HOST",
        "Untrusted Host header.",
        403,
      );
      if (req.headers.origin)
        requireThat(
          req.headers.origin === `http://${host}`,
          "ORIGIN",
          "Cross-origin requests are not allowed.",
          403,
        );
      const path = new URL(req.url, `http://${host}`).pathname;
      if (req.method === "GET" && files[path]) {
        const [file, type] = files[path];
        try {
          const data = await readFile(publicDir + file);
          res.writeHead(200, { "content-type": type + "; charset=utf-8" });
          res.end(data);
        } catch {
          send(res, 404, {
            error: {
              code: "ASSET_MISSING",
              message: "Run npm run build before starting the dashboard.",
            },
          });
        }
        return;
      }
      if (req.method === "GET" && path === "/health")
        return send(res, 200, {
          ok: true,
          name: "world-agent-wallet",
          mode: config.mode,
          version: "0.1.0",
        });
      const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      const admin = path.startsWith("/api/admin/");
      let agent;
      if (admin)
        requireThat(
          bearer && sameSecret(hash(bearer), store.get("admin_token_hash")),
          "UNAUTHORIZED",
          "Operator token required.",
          401,
        );
      else {
        agent = store.authenticate(bearer);
        requireThat(
          agent && !agent.revoked,
          "UNAUTHORIZED",
          "Active agent token required.",
          401,
        );
      }
      let data;
      if (req.method === "POST") data = await body(req);
      const match = path.match(
        /^\/api\/(?:admin\/)?operations\/([0-9a-f-]+)(?:\/(execute|approve|reject|acknowledge))?$/,
      );
      if (admin) {
        if (req.method === "GET" && path === "/api/admin/state")
          return send(res, 200, {
            budget: engine.budget(),
            agents: store.agents(),
            operations: store.list().map((op) => engine.publicOp(op)),
            services: config.services.map(({ maxMicros, ...s }) => s),
            world: identity.status(),
          });
        if (req.method === "POST" && path === "/api/admin/policy")
          return send(
            res,
            200,
            engine.changePolicy(
              z
                .object({ daily_limit: z.string(), auto_limit: z.string() })
                .strict()
                .parse(data),
            ),
          );
        if (req.method === "POST" && path === "/api/admin/agents") {
          const p = z
            .object({ name: z.string().min(1).max(60) })
            .strict()
            .parse(data);
          return send(res, 201, store.createAgent(p.name));
        }
        const revoke = path.match(
          /^\/api\/admin\/agents\/([0-9a-f-]+)\/revoke$/,
        );
        if (req.method === "POST" && revoke) {
          engine.revoke(revoke[1]);
          return send(res, 200, { revoked: true });
        }
        if (req.method === "POST" && match?.[2] === "approve")
          return send(
            res,
            200,
            engine.approve(
              match[1],
              z.object({ actionDigest: z.string() }).strict().parse(data),
            ),
          );
        if (req.method === "POST" && match?.[2] === "reject")
          return send(res, 200, engine.reject(match[1]));
        if (req.method === "POST" && match?.[2] === "acknowledge")
          return send(res, 200, engine.acknowledgeUncertain(match[1]));
        if (req.method === "POST" && path === "/api/admin/world/challenge") {
          const p = z
            .object({
              purpose: z.enum(["enroll", "approve"]),
              operation_id: z.string().optional(),
            })
            .strict()
            .parse(data);
          return send(res, 200, identity.challenge(p.purpose, p.operation_id));
        }
        if (req.method === "POST" && path === "/api/admin/world/verify") {
          const p = z
            .object({ challenge_id: z.string(), proof: z.unknown() })
            .strict()
            .parse(data);
          return send(res, 200, await identity.verify(p.challenge_id, p.proof));
        }
        if (req.method === "POST" && path === "/api/admin/demo") {
          requireThat(
            config.mode === "demo",
            "DEMO_DISABLED",
            "Demo execution is disabled in live mode.",
            403,
          );
          const { agent_id, ...args } = z
            .object({
              agent_id: z.string(),
              service_id: z.string(),
              input: z.record(z.string(), z.unknown()).default({}),
              idempotency_key: z.string(),
            })
            .strict()
            .parse(data);
          const op = await engine.prepare(agent_id, args);
          return send(
            res,
            200,
            op.status === "ready" ? await engine.execute(agent_id, op.id) : op,
          );
        }
        if (req.method === "POST" && path === "/api/admin/demo/execute") {
          requireThat(
            config.mode === "demo",
            "DEMO_DISABLED",
            "Demo execution is disabled in live mode.",
            403,
          );
          const p = z.object({ operation_id: z.string() }).strict().parse(data);
          const op = store.op(p.operation_id);
          requireThat(op, "NOT_FOUND", "Operation not found.", 404);
          return send(res, 200, await engine.execute(op.agentId, op.id));
        }
      } else {
        if (req.method === "GET" && path === "/api/status")
          return send(res, 200, {
            agent: { id: agent.id, name: agent.name },
            budget: engine.budget(),
            world: identity.status(),
          });
        if (req.method === "GET" && path === "/api/services")
          return send(
            res,
            200,
            config.services.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              max_price: s.price,
              input: s.input,
            })),
          );
        if (req.method === "GET" && path === "/api/operations")
          return send(
            res,
            200,
            store.list(agent.id).map((op) => engine.publicOp(op)),
          );
        if (req.method === "POST" && path === "/api/operations")
          return send(res, 201, await engine.prepare(agent.id, data));
        if (req.method === "GET" && match && !match[2])
          return send(res, 200, engine.get(agent.id, match[1]));
        if (req.method === "POST" && match?.[2] === "execute") {
          z.object({}).strict().parse(data);
          return send(res, 200, await engine.execute(agent.id, match[1]));
        }
      }
      throw new WalletError("NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      if (error instanceof z.ZodError)
        return send(res, 400, {
          error: {
            code: "INVALID_INPUT",
            message: "Request failed validation.",
            details: error.issues.map((i) => ({
              path: i.path,
              message: i.message,
            })),
          },
        });
      if (error instanceof WalletError)
        return send(res, error.status, {
          error: { code: error.code, message: error.message },
        });
      console.error("Request failed:", error.code || error.name);
      if (!res.headersSent)
        send(res, 500, {
          error: {
            code: "INTERNAL_ERROR",
            message: "Request failed. No automatic payment retry was made.",
          },
        });
      else res.end();
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  return server;
}
