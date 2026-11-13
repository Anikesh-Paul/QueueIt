import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("status page keeps the last known place offline and resyncs when back online", async ({ page, context, request }) => {
  const { admin } = tokens();
  const cafeteria = await queueByName(request, "Cafeteria");
  await ensureOpen(request, admin, cafeteria.id);
  const student = await registerStudent(request, "offline");
  const me = { Authorization: `Bearer ${student}` };
  const joined = await request.post(`${API}/api/queues/${cafeteria.id}/join`, { headers: me });
  expect(joined.status()).toBe(201);
  const { tokenNumber } = await joined.json();

  await signIn(page, student);
  await page.goto("/status");
  const token = page.getByTestId("arrival-token");
  await expect(token).toContainText(String(tokenNumber), { timeout: 15_000 });
  await expect(page.getByTestId("status-offline")).toHaveCount(0);

  await context.setOffline(true);
  const banner = page.getByTestId("status-offline");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "status");
  await expect(banner).toContainText("You’re offline");
  await expect(page.getByTestId("status-offline-as-of")).toContainText(/Last updated \d{1,2}:\d{2}/);
  // Last known ticket stays on screen, no error.
  await expect(token).toContainText(String(tokenNumber));
  await expect(page.getByTestId("status-heading")).toBeVisible();

  // Leaving offline explains itself instead of failing silently.
  await page.getByTestId("leave-queue").click();
  await page.getByTestId("leave-confirm").click();
  await expect(page.getByText("You’re offline, so you’re still in line.")).toBeVisible();
  await expect(page).toHaveURL(/\/status$/);

  // While offline, staff call this student; reconnecting must pick it up.
  const adminHeaders = { Authorization: `Bearer ${admin}` };
  const list = await (await request.get(`${API}/api/admin/queues/${cafeteria.id}/waiting-list`, { headers: adminHeaders })).json();
  for (const row of list.waiting.filter((r) => r.status === "serving")) {
    await request.post(`${API}/api/admin/queues/${cafeteria.id}/skip`, { headers: adminHeaders, data: { entryId: row.id } });
  }
  const entry = list.waiting.find((row) => row.tokenNumber === tokenNumber);
  const called = await request.post(`${API}/api/admin/queues/${cafeteria.id}/call`, { headers: adminHeaders, data: { entryId: entry.id } });
  expect(called.ok()).toBeTruthy();

  await context.setOffline(false);
  await expect(page.getByTestId("status-offline")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("called-banner")).toBeVisible({ timeout: 15_000 });

  await request.post(`${API}/api/admin/queues/${cafeteria.id}/skip`, { headers: adminHeaders, data: { entryId: entry.id } });
  await request.post(`${API}/api/queues/${cafeteria.id}/leave`, { headers: me });
});

test("joining while offline shows a friendly message", async ({ page, context, request }) => {
  const cafeteria = await queueByName(request, "Cafeteria");
  await ensureOpen(request, tokens().admin, cafeteria.id);
  const student = await registerStudent(request, "offline-join");

  await signIn(page, student);
  await page.goto("/queues");
  await expect(page.getByTestId("queues-heading")).toBeVisible({ timeout: 15_000 });
  await page.locator(".queue-card", { hasText: "Cafeteria" }).first().click();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Join Cafeteria" }).click();
  await expect(page.getByText("You’re offline, so we couldn’t join the line.")).toBeVisible();
  await expect(page).toHaveURL(/\/queues/);

  await context.setOffline(false);
  // Nothing was changed on the server.
  const active = await (await request.get(`${API}/api/queues/active`, { headers: { Authorization: `Bearer ${student}` } })).json();
  expect(active.memberships).toHaveLength(0);
});
