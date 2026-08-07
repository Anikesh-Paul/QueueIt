import { test, expect } from "@playwright/test";

/**
 * Shared smoke: login + queues list only (close-gate baseline).
 * Migrated from .scratch/playwright-smoke; product suite lives under e2e/.
 */
const USER_EMAIL = process.env.SEED_USER_EMAIL || "user@queueit.local";
const USER_PASSWORD = process.env.SEED_USER_PASSWORD || "user-demo-pass";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@queueit.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin-demo-pass";

test.describe("QueueIt shared smoke (login + queues list)", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/");

    // Unauth "/" redirects to the public /login (Router shell).
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("unauthenticated API rejects queue list", async ({ request }) => {
    const res = await request.get("http://localhost:5000/api/queues");
    expect(res.status()).toBe(401);
  });

  test("authenticated API returns seeded queues", async ({ request }) => {
    const login = await request.post("http://localhost:5000/api/auth/login", {
      data: { email: USER_EMAIL, password: USER_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const { token } = await login.json();

    const res = await request.get("http://localhost:5000/api/queues", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.queues).toHaveLength(2);
    expect(body.queues.map((q) => q.name).sort()).toEqual(["Cafeteria", "Gym"]);
    expect(body.queues[0].venue.name).toBe("Campus Hub");
  });

  test("user can log in and see seeded queues, then select one", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(USER_EMAIL);
    await page.getByLabel("Password").fill(USER_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("heading", { name: "Available queues" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/queues$/);
    await expect(page.getByText("Demo User", { exact: true })).toBeVisible();
    await expect(page.locator(".badge--user")).toHaveText("user");

    // Queue cards only (join CTA also includes the queue name).
    const cafeteria = page.locator(".queue-card", { hasText: "Cafeteria" });
    const gym = page.locator(".queue-card", { hasText: "Gym" });
    await expect(cafeteria).toBeVisible({ timeout: 10_000 });
    await expect(gym).toBeVisible();
    await expect(page.getByText(/Campus Hub/i).first()).toBeVisible();

    await cafeteria.click();
    await expect(page.getByRole("status")).toContainText(/Selected.*Cafeteria/i);
    await expect(cafeteria).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Join Cafeteria" })).toBeVisible();

    await gym.click();
    await expect(page.getByRole("status")).toContainText(/Selected.*Gym/i);
    await expect(gym).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Join Gym" })).toBeVisible();
  });

  test("admin can log in and see the same queue catalog", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("heading", { name: "Available queues" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".badge--admin")).toHaveText("admin");
    // No "Admin API ok/denied" after the overhaul shell.
    await expect(page.getByText(/Admin API/i)).toHaveCount(0);
    await expect(page.locator(".queue-card", { hasText: "Cafeteria" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(".queue-card", { hasText: "Gym" })).toBeVisible();
  });
});
