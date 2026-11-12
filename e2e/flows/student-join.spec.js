import { test, expect } from "@playwright/test";
import { ensureOpen, queueByName, tokens } from "./helpers.js";

const USER_EMAIL = process.env.SEED_USER_EMAIL || "user@queueit.local";
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || "user-demo-pass";

test("student logs in, joins a queue, sees live status, and leaves", async ({ page, request }) => {
  const cafeteria = await queueByName(request, "Cafeteria");
  await ensureOpen(request, tokens().admin, cafeteria.id);

  await page.goto("/login");
  await page.getByLabel("Email").fill(USER_EMAIL);
  await page.getByLabel("Password").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("queues-heading")).toBeVisible({ timeout: 15_000 });

  await page.locator(".queue-card", { hasText: "Cafeteria" }).first().click();
  await page.getByRole("button", { name: "Join Cafeteria" }).click();

  await expect(page).toHaveURL(/\/status$/, { timeout: 15_000 });
  await expect(page.getByTestId("status-heading")).toBeVisible();
  await expect(page.getByTestId("status-metrics")).toBeVisible();
  await expect(page.getByTestId("arrival-token")).toBeVisible();

  // Leave-when-it's-time: default travel time is 10 min and can be changed.
  const leaveCard = page.getByTestId("leave-card");
  await expect(leaveCard).toBeVisible();
  await expect(page.getByTestId("travel-10")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("travel-20").click();
  await expect(page.getByTestId("travel-20")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("leave-queue").click();
  await expect(page.getByTestId("leave-dialog")).toBeVisible();
  await page.getByTestId("leave-confirm").click();
  await expect(page).toHaveURL(/\/queues/, { timeout: 15_000 });
});
