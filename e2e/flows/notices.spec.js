import { test, expect } from "@playwright/test";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

test("staff post a notice to one line and people in it see it", async ({ page, browser, request }) => {
  const { admin } = tokens();
  const gym = await queueByName(request, "Gym");
  await ensureOpen(request, admin, gym.id);
  const title = `Mats being cleaned ${Date.now() % 100000}`;

  await signIn(page, admin);
  await page.goto("/admin/notices");
  await expect(page.getByTestId("notices-heading")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("notice-audience").selectOption(`queue:${gym.id}`);
  await page.getByTestId("notice-tone-delay").check({ force: true });
  await page.getByTestId("notice-title").fill(title);
  await page.getByTestId("notice-body").fill("Expect about 10 extra minutes.");
  await page.getByTestId("notice-post").click();
  await expect(page.getByTestId("notice-posted")).toBeVisible();
  const row = page.getByTestId("console-notice").filter({ hasText: title });
  await expect(row.getByTestId("console-notice-state")).toHaveText("Live");

  const student = await registerStudent(request, "notice");
  const join = await request.post(`${API}/api/queues/${gym.id}/join`, { headers: { Authorization: `Bearer ${student}` } });
  expect(join.ok()).toBeTruthy();
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await signIn(sp, student);
  await sp.goto("/status");
  const notice = sp.getByTestId("notice").filter({ hasText: title });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toHaveAttribute("data-tone", "delay");
  await notice.getByTestId("notice-hide").click();
  await expect(sp.getByTestId("notice").filter({ hasText: title })).toHaveCount(0);
  await ctx.close();

  // End it so it doesn't leak into other specs.
  await row.getByTestId("console-notice-end").click();
  await row.getByTestId("console-notice-end-confirm").click();
  await expect(page.getByTestId("console-notice").filter({ hasText: title }).getByTestId("console-notice-state")).toHaveText("Ended");
  await request.post(`${API}/api/queues/${gym.id}/leave`, { headers: { Authorization: `Bearer ${student}` } });
});
