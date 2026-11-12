import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { API, ensureOpen, queueByName, signIn, tokens } from "./helpers.js";

test("audit log filters by kind and exports CSV", async ({ page, request }) => {
  const { admin } = tokens();
  const headers = { Authorization: `Bearer ${admin}` };
  const gym = await queueByName(request, "Gym");
  await request.post(`${API}/api/admin/queues/${gym.id}/pause`, { headers });
  await ensureOpen(request, admin, gym.id);

  await signIn(page, admin);
  await page.goto(`/admin/audit?queueId=${gym.id}`);
  await expect(page.getByTestId("audit-heading")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("audit-filter-queue")).toHaveValue(gym.id);
  await page.getByTestId("audit-filter-kind").selectOption("operations");
  await expect(page).toHaveURL(/category=operations/);
  await expect(page.locator('[data-testid="audit-row"][data-action="pause"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="audit-row"][data-action="queue-update"]')).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("audit-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("queueit-audit-log.csv");
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.split("\n")[0]).toBe("time_ist,action,kind,who,who_email,role,venue,queue,details");
  expect(csv).toContain(",pause,operations,");
  expect(csv).not.toContain(",queue-update,");
  await expect(page.getByTestId("audit-export-note")).toContainText("Downloaded");

  await page.getByTestId("audit-clear").click();
  await expect(page).not.toHaveURL(/category=/);
});
