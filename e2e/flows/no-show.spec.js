import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

/** Join, get called and get skipped by staff (a staff no-show), via the API. */
async function missOnce(request, admin, queueId, student, { rejoin = false } = {}) {
  const adminHeaders = { Authorization: `Bearer ${admin}` };
  const me = { Authorization: `Bearer ${student}` };
  if (rejoin) {
    const res = await request.post(`${API}/api/queues/${queueId}/rejoin`, { headers: me });
    expect(res.ok()).toBeTruthy();
  } else {
    const res = await request.post(`${API}/api/queues/${queueId}/join`, { headers: me });
    expect(res.status()).toBe(201);
  }
  const mine = await (await request.get(`${API}/api/queues/${queueId}/status`, { headers: me })).json();
  const list = await (await request.get(`${API}/api/admin/queues/${queueId}/waiting-list`, { headers: adminHeaders })).json();
  // Free the counter if an earlier spec left someone called.
  for (const row of list.waiting.filter((r) => r.status === "serving")) {
    await request.post(`${API}/api/admin/queues/${queueId}/skip`, { headers: adminHeaders, data: { entryId: row.id } });
  }
  const entry = list.waiting.find((row) => row.tokenNumber === mine.tokenNumber);
  const called = await request.post(`${API}/api/admin/queues/${queueId}/call`, { headers: adminHeaders, data: { entryId: entry.id } });
  expect(called.ok()).toBeTruthy();
  const skipped = await request.post(`${API}/api/admin/queues/${queueId}/skip`, { headers: adminHeaders, data: { entryId: entry.id } });
  expect(skipped.ok()).toBeTruthy();
}

test("no-shows: student sees why and can rejoin; staff see a frequent no-show flag", async ({ page, request }) => {
  const { admin } = tokens();
  const cafeteria = await queueByName(request, "Cafeteria");
  await ensureOpen(request, admin, cafeteria.id);
  const student = await registerStudent(request, "noshow");

  await missOnce(request, admin, cafeteria.id, student);

  await signIn(page, student);
  await page.goto("/status");
  const banner = page.getByTestId("missed-turn-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveAttribute("data-reason", "staff");
  await expect(page.getByTestId("missed-turn-reason")).toContainText("Staff skipped your turn");
  await expect(page.getByTestId("missed-turn-count")).toContainText("Missed turns in the last 30 days: 1");
  await expect(page.getByTestId("rejoin-queue")).toBeVisible();

  // Miss again after the rejoin, then once more on a fresh ticket: 3 in 30 days.
  await missOnce(request, admin, cafeteria.id, student, { rejoin: true });
  await missOnce(request, admin, cafeteria.id, student);
  const join = await request.post(`${API}/api/queues/${cafeteria.id}/join`, {
    headers: { Authorization: `Bearer ${student}` },
  });
  // Still inside the rejoin window for the last miss, so rejoin instead.
  if (join.status() === 409) {
    const res = await request.post(`${API}/api/queues/${cafeteria.id}/rejoin`, { headers: { Authorization: `Bearer ${student}` } });
    expect(res.ok()).toBeTruthy();
  }

  await signIn(page, admin);
  await page.goto(`/admin/queues/${cafeteria.id}`);
  await expect(page.getByTestId("waiting-frequent-no-show-badge").first()).toContainText("Frequent no-show · 3", { timeout: 15_000 });

  await page.goto("/admin/analytics");
  await expect(page.getByTestId("analytics-frequent-no-shows-table")).toContainText("E2E noshow", { timeout: 15_000 });

  await page.goto(`/admin/audit?queueId=${cafeteria.id}&category=operations`);
  await expect(page.locator('[data-testid="audit-row"][data-action="no-show-flag"]').first()).toBeVisible({ timeout: 15_000 });

  // Leave the line tidy for later specs.
  await request.post(`${API}/api/queues/${cafeteria.id}/leave`, { headers: { Authorization: `Bearer ${student}` } });
});
