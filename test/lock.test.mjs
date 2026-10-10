import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireGatewayLock } from "../src/lock.mjs";
test("only one gateway can own a data directory until the lock is released", () => {
  const dir = mkdtempSync(join(tmpdir(), "wallet-lock-"));
  try {
    const release = acquireGatewayLock(dir);
    assert.throws(() => acquireGatewayLock(dir), /Another gateway/);
    release();
    const releaseAgain = acquireGatewayLock(dir);
    releaseAgain();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
