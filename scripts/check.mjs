import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}
for (const file of ["src", "scripts", "test", "web"]
  .flatMap(walk)
  .concat(["public/app.js"])
  .filter((p) => /\.(mjs|js)$/.test(p))) {
  const r = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (r.status) process.exit(r.status);
}
console.log("All JavaScript modules passed syntax checks.");
