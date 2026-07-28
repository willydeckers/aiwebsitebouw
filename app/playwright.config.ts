import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { OPSLAG_STAAT } from "./e2e/global-setup";

// Spec section 8's end-to-end test. Runs against a REAL Supabase project —
// there is no local stack in this setup — so it creates and deletes its own
// leads, all prefixed "E2E-test ", and never touches anything else.
//
// Node's own env-file loader rather than dotenv: one fewer dependency for
// something the runtime has done natively since 20.12.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./e2e",
  // Serial: the tests share one Supabase project and clean up by name prefix,
  // so running them in parallel would have them deleting each other's data.
  workers: 1,
  fullyParallel: false,
  // Realtime and a live project make the odd flake inevitable; one retry keeps
  // that from being reported as a real failure, without hiding a true one.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: OPSLAG_STAAT,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Starts `next dev` unless something is already serving that port, so the
  // suite works both standalone and against a dev server you already have up.
  webServer: {
    command: "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
