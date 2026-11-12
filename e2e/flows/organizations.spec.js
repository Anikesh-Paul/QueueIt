import { test, expect } from "@playwright/test";
import { API, registerStudent, signIn, tokens } from "./helpers.js";

test("a second organization gets its own lines and students switch between them", async ({ page, browser, request }) => {
  const { admin } = tokens();
  const stamp = Date.now() % 1_000_000;
  const orgName = `Annex ${stamp}`;

  await signIn(page, admin);
  await page.goto("/admin/catalog");
  await expect(page.getByTestId("catalog-orgs")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("catalog-new-org-name").fill(orgName);
  await page.getByTestId("catalog-create-org").click();
  const orgRow = page.getByTestId("catalog-org").filter({ has: page.locator(`input[value="${orgName}"]`) });
  await expect(orgRow).toBeVisible();
  const slug = await orgRow.getAttribute("data-slug");

  await page.getByTestId("catalog-new-venue-name").fill(`Ward ${stamp}`);
  await page.getByTestId("catalog-new-venue-org").selectOption({ label: orgName });
  await page.getByTestId("catalog-create-venue").click();
  await expect(page.getByTestId("catalog-venue").filter({ has: page.locator(`input[value="Ward ${stamp}"]`) })).toBeVisible();

  // Queue via API to keep the spec short.
  const headers = { Authorization: `Bearer ${admin}` };
  const catalog = await (await request.get(`${API}/api/admin/catalog`, { headers })).json();
  const venue = catalog.venues.find((v) => v.name === `Ward ${stamp}`);
  const created = await request.post(`${API}/api/admin/queues`, { headers, data: { venueId: venue.id, name: `Clinic ${stamp}` } });
  expect(created.ok()).toBeTruthy();

  const student = await registerStudent(request, "org");
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await signIn(sp, student);
  await sp.goto(`/queues?org=${slug}`);
  await expect(sp.getByTestId("org-picker")).toBeVisible({ timeout: 15_000 });
  await expect(sp.locator(`[data-testid="org-option"][data-slug="${slug}"]`)).toHaveAttribute("aria-checked", "true");
  const catalogList = sp.getByTestId("queue-catalog");
  await expect(catalogList).toContainText(`Clinic ${stamp}`);
  await expect(catalogList).not.toContainText("Cafeteria");

  await sp.locator('[data-testid="org-option"][data-slug="main"]').click();
  await expect(catalogList).toContainText("Cafeteria");
  await expect(catalogList).not.toContainText(`Clinic ${stamp}`);
  // The choice sticks on this device.
  await sp.goto("/queues");
  await expect(sp.locator('[data-testid="org-option"][data-slug="main"]')).toHaveAttribute("aria-checked", "true");
  await ctx.close();

  // Archive the clinic so later runs and specs don't see it.
  await request.patch(`${API}/api/admin/queues/${(await created.json()).queue.id}`, { headers, data: { archived: true } });
});
