import { test, expect } from "@playwright/test";
import { API, queueByName, signIn, tokens } from "./helpers.js";

async function endIfOnShift(request, headers) {
  const board = await (await request.get(`${API}/api/admin/shifts`, { headers })).json();
  if (board.me) {
    await request.post(`${API}/api/admin/queues/${board.me.queue.id}/counters/${board.me.counter.id}/shift`, {
      headers,
      data: { action: "end" },
    });
  }
}

test("staff leave a handover note, see it on the next shift and resolve it", async ({ page, request }) => {
  const { admin } = tokens();
  const headers = { Authorization: `Bearer ${admin}` };
  const gym = await queueByName(request, "Gym");
  await endIfOnShift(request, headers);

  // Clear leftover notes from a previous run so this spec stays isolated.
  const existing = await (await request.get(`${API}/api/admin/queues/${gym.id}/notes`, { headers })).json();
  for (const note of existing.notes || []) {
    if (note.state !== "resolved") {
      await request.post(`${API}/api/admin/queues/${gym.id}/notes/${note.id}/resolve`, { headers });
    }
  }

  await signIn(page, admin);
  await page.goto(`/admin/queues/${gym.id}`);
  await expect(page.getByTestId("handover-panel")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("handover-body").fill("Printer jammed");
  await page.getByTestId("handover-compose-pin").check();
  await page.getByTestId("handover-post").click();
  const printer = page.getByTestId("handover-note").filter({ hasText: "Printer jammed" });
  await expect(printer).toBeVisible();
  await expect(printer).toHaveAttribute("data-pinned", "true");

  await page.goto("/admin/shift");
  await expect(page.getByTestId("shift-heading")).toBeVisible({ timeout: 15_000 });
  const gymCard = page.getByTestId("shift-queue").filter({ hasText: gym.name });
  const row = gymCard.getByTestId("shift-counter").first();
  await expect(row.getByTestId("shift-start").or(row.getByTestId("shift-open"))).toBeVisible({ timeout: 15_000 });
  if (!(await row.getByTestId("shift-start").isVisible())) await row.getByTestId("shift-open").click();
  await row.getByTestId("shift-start").click();
  await expect(page.getByTestId("shift-me")).toContainText(gym.name);
  // The pinned printer note is unread for this new shift.
  await expect(page.getByTestId("shift-unread-dialog")).toBeVisible();
  await page.getByTestId("shift-unread-ack").click();
  await expect(page.getByTestId("shift-unread-dialog")).toBeHidden();

  await page.getByTestId("shift-me-end").click();
  await expect(page.getByTestId("shift-end-note-dialog")).toBeVisible();
  await page.getByTestId("shift-end-note-body").fill("Ravi covering until 2");
  await page.getByTestId("shift-end-note-important").check();
  await page.getByTestId("shift-end-note-save").click();
  await expect(page.getByTestId("shift-me")).toContainText("not on a counter");

  const start = row.getByTestId("shift-start");
  if (!(await start.isVisible())) await row.getByTestId("shift-open").click();
  await row.getByTestId("shift-start").click();
  await expect(page.getByTestId("shift-unread-dialog")).toBeVisible();
  await expect(page.getByTestId("shift-unread-note")).toContainText("Ravi covering until 2");
  await page.getByTestId("shift-unread-ack").click();
  await expect(page.getByTestId("shift-unread-dialog")).toBeHidden();

  await page.goto(`/admin/queues/${gym.id}`);
  const ravi = page.getByTestId("handover-note").filter({ hasText: "Ravi covering until 2" });
  await expect(ravi).toBeVisible({ timeout: 15_000 });
  await expect(ravi).toHaveAttribute("data-important", "true");
  await ravi.getByTestId("handover-resolve").click();
  await expect(ravi).toHaveAttribute("data-state", "resolved");
  await printer.getByTestId("handover-resolve").click();
  await expect(printer).toHaveAttribute("data-state", "resolved");

  await endIfOnShift(request, headers);
  const board = await (await request.get(`${API}/api/admin/shifts`, { headers })).json();
  const gymRow = board.queues.find((q) => q.id === gym.id);
  const first = gymRow?.counters?.[0];
  if (first && first.state !== "open") {
    await request.post(`${API}/api/admin/queues/${gym.id}/counters/${first.id}/shift`, {
      headers,
      data: { action: "open" },
    });
  }
});
