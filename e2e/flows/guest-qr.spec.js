import { test, expect } from "@playwright/test";
import { ensureOpen, queueByName, signIn, tokens } from "./helpers.js";

test("a visitor scans the poster QR and joins as a guest without logging in", async ({ page, request }) => {
  const gym = await queueByName(request, "Gym");
  await ensureOpen(request, tokens().admin, gym.id);

  await page.goto(`/join/${gym.id}?src=qr`);
  await expect(page.getByTestId("join-qr-welcome")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Guest", { exact: true })).toBeVisible();
  await page.getByTestId("join-queue").click();

  await expect(page).toHaveURL(/\/status$/, { timeout: 15_000 });
  await expect(page.getByTestId("arrival-token")).toBeVisible();
  const credential = await page.evaluate(() => Object.keys(localStorage).some((k) => /guest/i.test(k)));
  expect(credential).toBe(true);
});

test("admins can open a printable poster and the kiosk shows a scan-to-join QR", async ({ page, request }) => {
  const gym = await queueByName(request, "Gym");
  await signIn(page, tokens().admin);
  await page.goto(`/admin/queues/${gym.id}/poster`);
  await expect(page.getByTestId("poster-sheet")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("poster-queue-name")).toHaveText("Gym");
  await expect(page.getByTestId("poster-sheet-link")).toContainText(`/join/${gym.id}`);
  await expect(page.getByTestId("poster-print")).toBeEnabled();

  await page.goto(`/kiosk/${gym.id}`);
  await expect(page.getByTestId("kiosk-scan-to-join")).toBeVisible({ timeout: 15_000 });
});
