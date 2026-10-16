import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1440, height: 1050 },
    locale: "en-US",
    trace: "off",
    screenshot: "off",
  },
});
