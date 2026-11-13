import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

async function serveOne(request, admin, queueId, label) {
  const headers = { Authorization: `Bearer ${admin}` };
  const student = await registerStudent(request, label);
  const join = await request.post(`${API}/api/queues/${queueId}/join`, { headers: { Authorization: `Bearer ${student}` } });
  expect(join.status()).toBe(201);
  const { tokenNumber } = await join.json();
  const list = await (await request.get(`${API}/api/admin/queues/${queueId}/waiting-list`, { headers })).json();
  const row = list.waiting.find((w) => w.tokenNumber === tokenNumber);
  const serve = await request.post(`${API}/api/admin/queues/${queueId}/serve`, { headers, data: { entryId: row.id } });
  expect(serve.status()).toBe(200);
}

test("live view: today's numbers refresh on their own, with queue, contrast and TV controls", async ({ page, request }) => {
  test.setTimeout(90_000);
  const { admin } = tokens();
  const gym = await queueByName(request, "Gym");
  await ensureOpen(request, admin, gym.id);

  await signIn(page, admin);
  await page.goto("/admin/catalog");
  await page.getByTestId("nav-live").first().click();
  await expect(page).toHaveURL(/\/admin\/live$/);
  await expect(page.getByTestId("live-heading")).toHaveText("Live view");
  await expect(page.getByTestId("live-scope")).toContainText("All organizations");
  await expect(page.getByTestId("live-updated")).toContainText("Updated");
  for (const id of ["live-served", "live-wait", "live-waiting", "live-noshows", "live-open-counters", "live-busiest"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.locator('[data-testid="live-queue-card"][data-name="Gym"]')).toBeVisible();

  // Serve someone through the API; the page picks it up on its next poll without a reload.
  const before = Number(await page.getByTestId("live-served").textContent());
  await serveOne(request, admin, gym.id, "live");
  await expect
    .poll(async () => Number(await page.getByTestId("live-served").textContent()), { timeout: 30_000, intervals: [1000] })
    .toBeGreaterThan(before);
  await expect(page.getByTestId("live-busiest")).not.toHaveText("—");

  // Pin one queue: the URL keeps the setting so a TV can bookmark it.
  await page.getByTestId("live-queue-select").selectOption(gym.id);
  await expect(page).toHaveURL(new RegExp(`queue=${gym.id}`));
  await expect(page.getByTestId("live-focus")).toHaveAttribute("data-name", "Gym");
  await expect(page.getByTestId("live-rotate-select")).toBeDisabled();
  await expect(page.getByTestId("live-focus-counters-list").getByTestId("live-counter").first()).toBeVisible();

  // High contrast.
  await page.getByTestId("live-contrast").click();
  await expect(page.getByTestId("live-contrast")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("live-view")).toHaveAttribute("data-contrast", "high");
  const bg = await page.getByTestId("live-view").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(0, 0, 0)");

  // TV mode hides the controls; Exit and Escape both leave it.
  await page.getByTestId("live-enter-tv").click();
  await expect(page.getByTestId("live-view")).toHaveAttribute("data-tv", "1");
  await expect(page.getByTestId("live-controls")).toHaveCount(0);
  await page.getByTestId("live-exit-tv").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.goto(`/admin/live?queue=${gym.id}&contrast=high&tv=1`);
  await expect(page.getByTestId("live-view")).toHaveAttribute("data-tv", "1");
  await expect(page.getByTestId("live-focus")).toHaveAttribute("data-name", "Gym");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-view")).toHaveAttribute("data-tv", "0");
  await expect(page).toHaveURL(/contrast=high/);
});

test("live view rotates between queues and keeps students out", async ({ page, request, browser }) => {
  test.setTimeout(60_000);
  const { admin, student } = tokens();
  await signIn(page, admin);
  await page.goto("/admin/live?rotate=10");
  const rotation = page.getByTestId("live-rotation");
  await expect(rotation).toContainText(/Queue 1 of \d+/);
  const first = await page.getByTestId("live-focus").getAttribute("data-name");
  await expect(rotation).toContainText(/Queue 2 of \d+/, { timeout: 15_000 });
  await expect(page.getByTestId("live-focus")).not.toHaveAttribute("data-name", first);

  // Students: the page redirects and the API refuses.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, student);
  await other.goto("/admin/live");
  await expect(other).toHaveURL(/\/queues$/);
  await ctx.close();
  const denied = await request.get(`${API}/api/admin/live`, { headers: { Authorization: `Bearer ${student}` } });
  expect(denied.status()).toBe(403);
  expect((await request.get(`${API}/api/admin/live`)).status()).toBe(401);
});
