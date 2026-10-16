import { test, expect } from "@playwright/test";
import { createWalletServer } from "../../src/http.mjs";
import { WorldIdentity } from "../../src/adapters/world-id.mjs";
import { hash, token } from "../../src/utils.mjs";
import { fixture } from "../helpers.mjs";

let f, server, base, operator;
test.beforeEach(async ({ page }) => {
  // Only an in-memory demo fixture is used; no environment files or live adapters.
  f = fixture();
  f.setTime(Date.now());
  operator = token();
  f.store.set("admin_token_hash", hash(operator));
  const identity = new WorldIdentity({ ...f, config: f.config.world });
  server = createWalletServer({ ...f, identity });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + server.address().port;
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
});
test.afterEach(async ({ page }) => {
  await page.close();
  await new Promise((resolve) => server.close(resolve));
  f.store.close();
});

async function login(page) {
  await page.goto(base);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Operator token", { exact: true }).fill(operator);
  await page.getByRole("button", { name: "Open dashboard" }).click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#operator-token")).toHaveValue("");
}

test("English dashboard supports simulated payments, approval and rejection", async ({
  page,
}) => {
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== base) external.push(request.url());
  });
  await login(page);
  await expect(page.locator("#mode-note")).toContainText(
    "without moving real funds",
  );
  await expect(page.locator("#approval-list")).toContainText(
    "No requests awaiting approval",
  );
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page.locator("#committed")).toHaveText("0.20");
  await expect(page.locator("#activity-body")).toContainText("Succeeded");
  await page.locator("#demo-service").selectOption("bess-analysis");
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page.locator("#pending")).toHaveText("1");
  await expect(page.locator("#approval-list")).toContainText("Valid until");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.locator("#detail-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Approve and continue" }).click();
  await expect(page.locator("#committed")).toHaveText("2.20");
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page.locator("#pending")).toHaveText("1");
  expect(await page.locator("body").innerText()).not.toMatch(
    /[\uac00-\ud7a3]/u,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "docs/dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({ path: "docs/dashboard-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.locator("#activity-body")).toContainText("Rejected");
  await expect(page.locator("#committed")).toHaveText("2.20");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("English policy feedback and narrow-screen controls remain usable", async ({
  page,
}) => {
  await login(page);
  await page.locator("#daily-limit").fill("6");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.locator("#message")).toContainText("Spending policy saved");
  await expect(page.locator("#daily")).toHaveText("6.00");
  await expect(page.locator("#world-enroll")).toHaveText("Connect World ID ↗");
  await expect(page.locator("#world-enroll")).toBeDisabled();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#login")).toBeVisible();
});
