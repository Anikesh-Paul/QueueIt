import { test, expect } from "@playwright/test";

/**
 * Public campus wait board — no login, no writing catalog GET.
 */

/**
 * Other flow specs add queues in their own organizations to the shared e2e DB,
 * and the board lists every campus. Count only the seeded campus (default org).
 */
const SEEDED_ORG = '[data-testid="board-org"][data-slug="main"]';

function isWritingCatalog(url) {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "") || "/";
    return path === "/api/queues";
  } catch {
    return false;
  }
}

test("public status board: no sign-in, seeded queues, wait copy, copy-link", async ({ page }) => {
  const catalogHits = [];
  page.on("request", (req) => {
    if (isWritingCatalog(req.url())) catalogHits.push(req.url());
  });

  await page.goto("/status-board");
  await expect(page).toHaveURL(/\/status-board$/);
  await expect(page.getByTestId("board-heading")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("board-copy")).toBeVisible();
  await expect(page.getByTestId("board-updated")).toBeVisible();

  const cafe = page.locator('[data-testid="board-card"][data-name="Cafeteria"]');
  const gym = page.locator('[data-testid="board-card"][data-name="Gym"]');
  await expect(cafe).toBeVisible({ timeout: 15_000 });
  await expect(gym).toBeVisible();
  const seeded = page.locator(SEEDED_ORG);
  await expect(seeded.getByTestId("board-venue")).toContainText("Campus Hub");
  await expect(cafe.getByTestId("board-wait")).toContainText(/Little or no wait|Wait about/);
  await expect(cafe.getByTestId("board-join")).toBeVisible();
  await expect(seeded.getByTestId("board-card")).toHaveCount(2);
  expect(catalogHits, "must not call writing GET /api/queues").toEqual([]);
});

test("unknown org filter stays empty instead of leaking other campuses", async ({ page }) => {
  await page.goto("/status-board?org=no-such-org");
  await expect(page.getByTestId("board-missing")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("board-card")).toHaveCount(0);
  await page.getByTestId("board-show-all").click();
  await expect(page).toHaveURL(/\/status-board$/);
  await expect(page.locator(SEEDED_ORG).getByTestId("board-card")).toHaveCount(2, { timeout: 15_000 });
});

for (const { name, width, height } of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]) {
  test(`status board has no horizontal overflow (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/status-board");
    await expect(page.getByTestId("board-heading")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(SEEDED_ORG).getByTestId("board-card")).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}
