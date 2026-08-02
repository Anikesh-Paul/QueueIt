import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// SEED_* / JWT for tests and webServer children (dotenv does not override pre-set env).
dotenv.config({ path: path.join(rootDir, "server", ".env") });

/** Dedicated e2e DB — never the developer `queueit` database. */
const E2E_MONGODB_URI =
  process.env.MONGODB_URI_E2E?.trim() ||
  "mongodb://127.0.0.1:27017/queueit-e2e";

// Pin process env so API webServer inherits the e2e URI (not server/.env queueit).
process.env.MONGODB_URI = E2E_MONGODB_URI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    // HTML report always (reporter above); traces only on failure.
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      name: "API",
      command: "npm run start -w server",
      url: "http://localhost:5000/api/health",
      // Prefer a clean e2e stack; set CI=1 to never reuse. Local reuse only if
      // something is already listening (must already be on queueit-e2e).
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        MONGODB_URI: E2E_MONGODB_URI,
      },
    },
    {
      name: "Client",
      command: "npm run dev -w client",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
