import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function acquireGatewayLock(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "server.lock");
  const marker = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, marker }), {
        flag: "wx",
        mode: 0o600,
      });
      return () => {
        try {
          if (JSON.parse(readFileSync(path, "utf8")).marker === marker)
            unlinkSync(path);
        } catch {}
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try {
        previous = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        throw new Error(
          "Gateway lock is unreadable. Check the running server before removing server.lock.",
        );
      }
      if (!Number.isInteger(previous.pid) || previous.pid <= 0)
        throw new Error("Invalid gateway lock.");
      try {
        process.kill(previous.pid, 0);
      } catch (probe) {
        if (probe.code === "ESRCH") {
          unlinkSync(path);
          continue;
        }
        throw probe;
      }
      throw new Error(
        "Another gateway owns this data directory. Use the running gateway or a separate WALLET_DATA_DIR.",
      );
    }
  }
  throw new Error("Could not acquire the gateway data lock.");
}
