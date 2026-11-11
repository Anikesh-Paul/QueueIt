import { test, expect } from "@playwright/test";
import { signIn, tokens } from "./helpers.js";

test("dark mode toggle is saved and applied before first paint", async ({ page }) => {
  await signIn(page, tokens().student);
  await page.goto("/queues");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("queueit_theme"))).toBe("dark");

  await page.reload({ waitUntil: "domcontentloaded" });
  // The inline head script sets the class before React mounts.
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#141412");
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Switch to light theme");
});

test.describe("system preference", () => {
  test.use({ colorScheme: "dark" });
  test("follows the OS setting until the user chooses", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});

test("keyboard users can skip to content and see focus", async ({ page }) => {
  await signIn(page, tokens().student);
  await page.goto("/queues");
  await expect(page.getByTestId("queues-heading")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to content/i });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main-content");
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { tag: el.tagName, boxShadow: style.boxShadow, outline: style.outlineStyle };
  });
  expect(ring.boxShadow !== "none" || ring.outline !== "none").toBe(true);
});
