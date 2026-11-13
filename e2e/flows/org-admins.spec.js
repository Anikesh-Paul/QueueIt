import { test, expect } from "@playwright/test";
import { API, queueByName, tokens } from "./helpers.js";

/** A fresh organization with one venue and one (archived) line (global admin API). */
async function makeOrg(request, stamp) {
  const headers = { Authorization: `Bearer ${tokens().admin}` };
  const org = await (await request.post(`${API}/api/admin/organizations`, { headers, data: { name: `Annex ${stamp}` } })).json();
  const venue = await (
    await request.post(`${API}/api/admin/venues`, { headers, data: { name: `Ward ${stamp}`, organizationId: org.organization.id } })
  ).json();
  const queue = await (await request.post(`${API}/api/admin/queues`, { headers, data: { venueId: venue.venue.id, name: `Clinic ${stamp}` } })).json();
  // Archive straight away: admins still manage it, but parallel specs that
  // count the public catalog never see it.
  await request.patch(`${API}/api/admin/queues/${queue.queue.id}`, { headers, data: { archived: true } });
  return { headers, org: org.organization, venue: venue.venue, queue: queue.queue };
}

test("a global admin limits a new admin to one organization, and the server enforces it", async ({ page, browser, request }) => {
  const stamp = Date.now() % 1_000_000;
  const { headers, org, venue, queue } = await makeOrg(request, stamp);
  const cafeteria = await queueByName(request, "Cafeteria");
  const email = `e2e-orgadmin-${stamp}@example.com`;
  const password = "org-admin-pass-1";

  // Global admin adds the organization admin from the Access page.
  await page.addInitScript((t) => window.localStorage.setItem("queueit_token", t), tokens().admin);
  await page.goto("/admin/access");
  await expect(page.getByTestId("access-heading")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("access-invite-name").fill(`Annex Admin ${stamp}`);
  await page.getByTestId("access-invite-email").fill(email);
  await page.getByTestId("access-invite-password").fill(password);
  await page.getByTestId(`access-invite-org-${org.id}`).check();
  await page.getByTestId("access-invite-submit").click();
  await expect(page.getByTestId("access-invited")).toContainText(email);
  const row = page.locator(`[data-testid="access-admin-row"][data-email="${email}"]`);
  await expect(row.getByTestId("access-admin-scope")).toHaveText(org.name);

  // The organization admin signs in and only sees their organization.
  const ctx = await browser.newContext();
  const op = await ctx.newPage();
  await op.goto("/login");
  await op.getByLabel("Email").fill(email);
  await op.getByLabel("Password").fill(password);
  await op.getByRole("button", { name: "Log in" }).click();
  await expect(op.getByTestId("identity-chip")).toContainText("Org admin", { timeout: 15_000 });
  await expect(op.getByTestId("nav-access")).toHaveCount(0);
  await op.goto("/admin/catalog");
  await expect(op.getByTestId("catalog-scope")).toContainText(org.name);
  const venues = op.getByTestId("catalog-venue");
  await expect(venues).toHaveCount(1);
  await expect(venues.first().getByTestId("catalog-venue-name")).toHaveValue(venue.name);
  await expect(op.getByTestId("catalog-orgs")).toHaveCount(0);
  await op.goto("/admin/access");
  await expect(op).toHaveURL(/\/admin\/catalog$/);

  // Hidden in the UI *and* refused by the server.
  const orgToken = await op.evaluate(() => window.localStorage.getItem("queueit_token"));
  const as = { Authorization: `Bearer ${orgToken}` };
  expect((await request.get(`${API}/api/admin/queues/${cafeteria.id}/waiting-list`, { headers: as })).status()).toBe(403);
  expect((await request.post(`${API}/api/admin/queues/${cafeteria.id}/pause`, { headers: as })).status()).toBe(403);
  expect((await request.get(`${API}/api/admin/analytics?venueId=${cafeteria.venue.id}`, { headers: as })).status()).toBe(403);
  expect((await request.get(`${API}/api/admin/people`, { headers: as })).status()).toBe(403);
  expect((await request.get(`${API}/api/admin/queues/${queue.id}/waiting-list`, { headers: as })).status()).toBe(200);
  await op.goto(`/admin/queues/${cafeteria.id}`);
  await expect(op.getByTestId("admin-no-access")).toContainText("You don't have access to this venue", { timeout: 15_000 });

  // The global admin adds the main campus: same session, no re-login.
  await row.locator('input[data-testid$="-org-default"]').check();
  await row.getByTestId("access-admin-save").click();
  await expect(page.getByTestId("access-notice")).toContainText("Main campus");
  await expect(row.getByTestId("access-admin-scope")).toContainText("Main campus");
  expect((await request.get(`${API}/api/admin/queues/${cafeteria.id}/waiting-list`, { headers: as })).status()).toBe(200);
  await op.goto("/admin/catalog");
  await expect(op.getByTestId("catalog-venue")).toHaveCount(2);

  // …and takes it away again.
  await row.locator('input[data-testid$="-org-default"]').uncheck();
  await row.getByTestId("access-admin-save").click();
  await expect(row.getByTestId("access-admin-scope")).toHaveText(org.name);
  expect((await request.get(`${API}/api/admin/queues/${cafeteria.id}/waiting-list`, { headers: as })).status()).toBe(403);

  // Every change is in the audit log (global admins only).
  const audit = await (await request.get(`${API}/api/admin/audit?category=staff`, { headers })).json();
  const mine = audit.events.filter((e) => e.meta?.email === email).map((e) => e.action);
  expect(mine).toEqual(["admin-scope", "admin-scope", "admin-invite"]);
  const theirs = await (await request.get(`${API}/api/admin/audit`, { headers: as })).json();
  expect(theirs.events.every((e) => e.venue?.id === venue.id)).toBeTruthy();

  await ctx.close();
});

test("staff move to another organization from the Access page", async ({ page, request }) => {
  const stamp = Date.now() % 1_000_000;
  const { headers, org, venue } = await makeOrg(request, `s${stamp}`);
  const cafeteria = await queueByName(request, "Cafeteria");
  const email = `e2e-move-${stamp}@example.com`;
  const invite = await request.post(`${API}/api/admin/staff`, {
    headers,
    data: { name: `Mover ${stamp}`, email, venueId: cafeteria.venue.id, temporaryPassword: "staff-pass-123" },
  });
  expect(invite.status()).toBe(201);

  await page.addInitScript((t) => window.localStorage.setItem("queueit_token", t), tokens().admin);
  await page.goto("/admin/access");
  const row = page.locator(`[data-testid="access-staff-row"][data-email="${email}"]`);
  await expect(row.getByTestId("access-staff-scope")).toContainText("Main campus", { timeout: 15_000 });
  await row.getByTestId("access-staff-venue").selectOption(venue.id);
  await row.getByTestId("access-staff-move").click();
  await expect(row.getByTestId("access-staff-scope")).toHaveText(`${venue.name} · ${org.name}`);

  const audit = await (await request.get(`${API}/api/admin/audit?category=staff`, { headers })).json();
  const move = audit.events.find((e) => e.action === "staff-move" && e.meta?.email === email);
  expect(move.meta).toMatchObject({ from: cafeteria.venue.name, to: venue.name, fromOrg: "Main campus", toOrg: org.name });
});
