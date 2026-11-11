import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { signIn, tokens } from "./helpers.js";

test("admin analytics: presets, custom range validation and CSV export", async ({ page }) => {
  await signIn(page, tokens().admin);
  await page.goto("/admin/analytics");
  await expect(page.getByTestId("campus-analytics-heading")).toHaveText("Analytics");
  await expect(page.getByTestId("campus-analytics-served")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("analytics-no-show-rate")).toBeVisible();
  await expect(page.getByTestId("analytics-peak-hour")).toBeVisible();

  await page.getByTestId("analytics-preset-30d").click();
  await expect(page.getByTestId("analytics-preset-30d")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("analytics-preset-custom").click();
  await page.getByTestId("analytics-from").fill("2026-11-10");
  await page.getByTestId("analytics-to").fill("2026-11-01");
  await page.getByTestId("analytics-apply").click();
  await expect(page.getByTestId("analytics-range-error")).toContainText("on or before");

  await page.getByTestId("analytics-from").fill("2026-11-01");
  await page.getByTestId("analytics-to").fill("2026-11-07");
  await page.getByTestId("analytics-apply").click();
  await expect(page.getByTestId("analytics-range-label")).toContainText("1 Nov");

  const download = page.waitForEvent("download");
  await page.getByTestId("campus-analytics-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("queueit-report-2026-11-01-to-2026-11-07.csv");
  const text = fs.readFileSync(await file.path(), "utf8");
  expect(text.split("\n")[0]).toBe("section,label,venue,served,no_shows,left,no_show_rate_pct,avg_wait_min,p90_wait_min");
  expect(text.match(/^daily,/gm)).toHaveLength(7);
});

test("students are kept out of admin analytics", async ({ page }) => {
  await signIn(page, tokens().student);
  await page.goto("/admin/analytics");
  await expect(page).toHaveURL(/\/queues$/);
});
