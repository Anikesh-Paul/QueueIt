import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("wait estimates show a range and say what they rest on", async ({ page, browser, request }) => {
  const { admin } = tokens();
  const gym = await queueByName(request, "Gym");
  await ensureOpen(request, admin, gym.id);

  const student = await registerStudent(request, "estimate");
  const auth = { Authorization: `Bearer ${student}` };
  const join = await request.post(`${API}/api/queues/${gym.id}/join`, { headers: auth });
  expect(join.ok()).toBeTruthy();
  const status = await (await request.get(`${API}/api/queues/${gym.id}/status`, { headers: auth })).json();
  expect(status.etaRange.low).toBeLessThanOrEqual(status.etaMinutes);
  expect(status.etaRange.high).toBeGreaterThanOrEqual(status.etaMinutes);
  expect(["low", "medium", "high"]).toContain(status.etaConfidence);

  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await signIn(sp, student);
  await sp.goto("/status");
  await expect(sp.getByTestId("eta-minutes")).toHaveText(/^\d+(–\d+)? min$/, { timeout: 15_000 });
  await expect(sp.getByTestId("status-estimate-basis")).toBeVisible();
  await expect(sp.getByTestId("status-estimate-basis")).toHaveAttribute("data-confidence", status.etaConfidence);
  await ctx.close();
  await request.post(`${API}/api/queues/${gym.id}/leave`, { headers: auth });

  await signIn(page, admin);
  await page.goto("/queues");
  const card = page.getByTestId("queue-card").filter({ hasText: "Gym" });
  await expect(card.getByTestId("queue-wait-estimate")).toHaveText(/^(Wait about \d+(–\d+)? min|Little or no wait)$/, { timeout: 15_000 });

  await page.goto("/admin/shift");
  const shiftQueue = page.getByTestId("shift-queue").filter({ hasText: "Gym" });
  await expect(shiftQueue.getByTestId("shift-queue-estimate")).toContainText("Pace");
});
