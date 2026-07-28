import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Spec section 8: "minstens een basis end-to-end-test".
//
// The path this covers is the one the whole product hangs off: a lead is
// created, it shows up in the list, its panel opens, a queued job is picked up
// by Realtime without a refresh, and deleting the lead cleans up after itself.
//
// Deliberately NOT covered: actually running research/generatie/review. Those
// cost real money per run (the €5-per-lead budget is real), need the worker
// running, and take minutes. What's tested here is that the app reacts
// correctly to job state — which is the part that breaks silently, as it did
// in July when every Edge Function error surfaced as the same generic message.
//
// Jobs are inserted directly with the service-role key rather than triggered
// through the UI, for the same reason: this asserts the app's reaction, not
// the AI's output.

const TEST_PREFIX = "E2E-test ";

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Leaves nothing behind, even if a test failed halfway. */
async function ruimTestLeadsOp(admin: SupabaseClient) {
  const { data } = await admin.from("leads").select("id").like("bedrijfsnaam", `${TEST_PREFIX}%`);
  for (const lead of data ?? []) {
    await admin.from("jobs").delete().eq("lead_id", lead.id);
    await admin.from("leads").delete().eq("id", lead.id);
  }
}

test.beforeEach(async () => {
  await ruimTestLeadsOp(adminClient());
});

test.afterEach(async () => {
  await ruimTestLeadsOp(adminClient());
});

test("een lead verschijnt in de lijst en opent in het paneel", async ({ page }) => {
  const admin = adminClient();
  const naam = `${TEST_PREFIX}${Date.now()}`;

  const { data: lead, error } = await admin
    .from("leads")
    .insert({ bedrijfsnaam: naam, sector: "Tuinaanleg en tuinonderhoud", herkomst: "manueel" })
    .select("id")
    .single();
  expect(error, error?.message).toBeNull();

  await page.goto("/leads");
  const rij = page.getByRole("row", { name: new RegExp(naam) });
  await expect(rij).toBeVisible({ timeout: 15_000 });

  await rij.click();
  // The panel is the detail view; its heading is the company name.
  await expect(page.getByRole("heading", { name: naam })).toBeVisible();

  // Clicking the blurred backdrop closes the panel — the behaviour added
  // because a dimmed overlay reads as "click here to go back".
  //
  // Click inside the dimmed area, not at x=20: the sidebar sits above the
  // backdrop and stays crisp, so a click there navigates instead of closing.
  // Low on the page, below the last row, so this doesn't open another lead.
  await page.mouse.click(560, 660);
  await expect(page.getByRole("heading", { name: naam })).toBeHidden();

  await admin.from("leads").delete().eq("id", lead!.id);
});

test("een lopende job verschijnt via Realtime zonder verversen", async ({ page }) => {
  const admin = adminClient();
  const naam = `${TEST_PREFIX}realtime ${Date.now()}`;

  const { data: lead } = await admin
    .from("leads")
    .insert({ bedrijfsnaam: naam, sector: "Bloemenhandel", herkomst: "manueel" })
    .select("id")
    .single();

  await page.goto("/leads");
  await page.getByRole("row", { name: new RegExp(naam) }).click();
  await expect(page.getByRole("heading", { name: naam })).toBeVisible();

  // Insert a job while the panel is open. Nothing is refreshed — if this shows
  // up, the Realtime subscription on `jobs` is genuinely wired.
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      lead_id: lead!.id,
      type: "research",
      status: "bezig",
      gestart_op: new Date().toISOString(),
    })
    .select("id")
    .single();
  expect(jobError, jobError?.message).toBeNull();

  // Assert on the job line itself rather than on bare words: "research" and
  // "bezig" also appear in the status pills above, so a page-wide text match
  // proves nothing about the job indicator.
  const jobRegel = page.getByText(/Laatste job:/);
  await expect(jobRegel).toBeVisible({ timeout: 20_000 });
  await expect(jobRegel).toContainText("research");
  await expect(jobRegel).toContainText("bezig");

  // And a finished job stops claiming to be running.
  await admin
    .from("jobs")
    .update({ status: "klaar", afgerond_op: new Date().toISOString() })
    .eq("id", job!.id);
  await expect(jobRegel).toContainText("klaar", { timeout: 20_000 });
});

test("een mislukte job toont de echte foutmelding, niet een generieke", async ({ page }) => {
  // This is the regression guard for the July bug where every Edge Function
  // failure surfaced as "non-2xx status code" and hid the real cause for days.
  const admin = adminClient();
  const naam = `${TEST_PREFIX}fout ${Date.now()}`;
  const foutTekst = "Herkenbare testfout 12345";

  const { data: lead } = await admin
    .from("leads")
    .insert({ bedrijfsnaam: naam, sector: "Horeca", herkomst: "manueel" })
    .select("id")
    .single();

  await admin.from("jobs").insert({
    lead_id: lead!.id,
    type: "generatie",
    status: "mislukt",
    error_message: foutTekst,
    gestart_op: new Date().toISOString(),
    afgerond_op: new Date().toISOString(),
  });

  await page.goto("/leads");
  await page.getByRole("row", { name: new RegExp(naam) }).click();
  await expect(page.getByText(foutTekst)).toBeVisible({ timeout: 15_000 });
});

test("Voorkeuren toont de regels die elke generatie sturen", async ({ page }) => {
  // Stijlvoorkeuren apply to every lead and were invisible until recently —
  // which is how one client's instruction leaked into another client's site
  // without anyone being able to see it had happened.
  await page.goto("/voorkeuren");
  await expect(page.getByRole("heading", { name: "Stijlvoorkeuren" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sectorkennis" })).toBeVisible();
  await expect(page.getByText(/alleen het uiterlijk van dit programma|Kleuren van dit dashboard/i)).toBeVisible();
});
