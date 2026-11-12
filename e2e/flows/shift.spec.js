import { test, expect } from "@playwright/test";
import { API, queueByName, signIn, tokens } from "./helpers.js";

test("staff start a shift, take a break and come back", async ({ page, request }) => {
  const { admin } = tokens();
  const headers = { Authorization: `Bearer ${admin}` };
  const gym = await queueByName(request, "Gym");
  const board = await (await request.get(`${API}/api/admin/shifts`, { headers })).json();
  if (board.me) {
    await request.post(`${API}/api/admin/queues/${board.me.queue.id}/counters/${board.me.counter.id}/shift`, { headers, data: { action: "end" } });
  }

  await signIn(page, admin);
  await page.goto("/admin/shift");
  await expect(page.getByTestId("shift-heading")).toBeVisible({ timeout: 15_000 });
  const gymCard = page.getByTestId("shift-queue").filter({ hasText: gym.name });
  const row = gymCard.getByTestId("shift-counter").first();
  const start = row.getByTestId("shift-start");
  if (!(await start.isVisible())) await row.getByTestId("shift-open").click();
  await row.getByTestId("shift-start").click();
  await expect(page.getByTestId("shift-me")).toContainText(gym.name);

  await page.getByTestId("shift-me-break").click();
  await expect(page.getByTestId("shift-me").getByTestId("shift-state")).toHaveAttribute("data-state", "break");
  await expect(gymCard.getByTestId("shift-queue-summary")).toContainText("Counter closed");

  await page.getByTestId("shift-me-back").click();
  await expect(page.getByTestId("shift-me").getByTestId("shift-state")).toHaveAttribute("data-state", "open");
  await page.getByTestId("shift-me-end").click();
  await expect(page.getByTestId("shift-me")).toContainText("not on a counter");
  // Leave Gym taking calls for the other specs.
  await gymCard.getByTestId("shift-counter").first().getByTestId("shift-open").click();
  await expect(gymCard.getByTestId("shift-queue-summary")).toContainText("Counter open");
});
