import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./helpers.mjs";

test("first-party interface and documentation default to English", async () => {
  for (const file of [
    "public/index.html",
    "public/app.js",
    "web/world-id.js",
    "README.md",
    "docs/world-integration.md",
  ]) {
    const source = await readFile(
      new URL("../" + file, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /[\uac00-\ud7a3]/u, file);
    if (file.endsWith(".html")) assert.match(source, /lang="en"/, file);
  }
  const app = await readFile(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(app, /ko-KR/);
  assert.match(app, /toLocaleTimeString\("en-US"/);
});

test("English display defaults preserve user names and budget timezone", () => {
  const f = fixture();
  try {
    const name = "연구 에이전트";
    const agent = f.store.createAgent(name);
    assert.equal(f.store.agents().find((a) => a.id === agent.id).name, name);
    assert.equal(f.engine.budget().timezone, "Asia/Seoul");
  } finally {
    f.store.close();
  }
});
