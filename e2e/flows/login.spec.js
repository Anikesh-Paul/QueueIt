import { test, expect } from "@playwright/test";
import { API } from "./helpers.js";

const PASSWORD = "password123";

async function makeAccount(request, label) {
  const email = `e2e-login-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { email, password: PASSWORD, name: `E2E login ${label}` },
  });
  expect(res.ok()).toBeTruthy();
  return email;
}

test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("one centred card holds the form", async ({ page }) => {
    await page.goto("/login");
    const card = page.getByTestId("auth-card");
    await expect(card).toBeVisible();
    // Centred: equal space either side of the card.
    const box = await card.boundingBox();
    expect(Math.abs(box.x - (1280 - box.x - box.width))).toBeLessThan(4);
    await expect(page.getByTestId("auth-footer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(page.getByTestId("register-link")).toBeVisible();
    await expect(page.getByTestId("forgot-password-link")).toBeVisible();
    await expect(page.getByTestId("continue-as-guest")).toBeVisible();
  });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("phone shows the form edge to edge with no overflow", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("auth-card")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});

test("inline validation flags bad input and moves focus to the first problem", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("email-error")).toHaveText("Enter your email address.");
  await expect(page.getByTestId("password-error")).toHaveText("Enter your password.");
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Email").blur();
  await expect(page.getByTestId("email-error")).toHaveText("Enter an email like name@example.com.");
  await page.getByLabel("Email").fill("ana@example.com");
  await expect(page.getByTestId("email-error")).toHaveCount(0);
});

test("show/hide toggle reveals the password and Caps Lock warns", async ({ page }) => {
  await page.goto("/login");
  const pw = page.getByLabel("Password", { exact: true });
  await pw.fill("secret-pass");
  await expect(pw).toHaveAttribute("type", "password");
  const toggle = page.getByTestId("password-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(pw).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(pw).toHaveAttribute("type", "password");

  await pw.focus();
  await pw.dispatchEvent("keydown", { key: "A", modifierCapsLock: true });
  await expect(page.getByTestId("password-caps")).toContainText("Caps Lock is on");
  await expect(page.getByTestId("password-caps")).toHaveAttribute("role", "status");
  await pw.dispatchEvent("keyup", { key: "a", modifierCapsLock: false });
  await expect(page.getByTestId("password-caps")).toHaveCount(0);
});

test("a wrong password shows a clear error alert", async ({ page, request }) => {
  const email = await makeAccount(request, "wrong");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  const alert = page.getByTestId("auth-error");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Invalid email or password");
});

test("successful login shows a loading state, then lands in the app", async ({ page, request }) => {
  const email = await makeAccount(request, "ok");
  await page.route("**/api/auth/login", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(`  ${email}  `);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  const submit = page.getByTestId("auth-submit");
  await expect(submit).toHaveText("Signing in…");
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await expect(submit).toBeDisabled();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByTestId("identity-chip")).toBeVisible({ timeout: 15_000 });
});

test("register validates the password length and links back to login", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("register-link").click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Register");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Password", { exact: true }).blur();
  await expect(page.getByTestId("password-error")).toHaveText("Use at least 8 characters.");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("name-error")).toHaveText("Enter your name.");
  await page.getByTestId("login-link").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("forgot password validates, then confirms without revealing the account", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("forgot-password-link").click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByTestId("forgot-password-submit").click();
  await expect(page.getByTestId("email-error")).toHaveText("Enter your email address.");
  await page.getByTestId("forgot-password-email").fill(`nobody-${Date.now()}@example.com`);
  await page.getByTestId("forgot-password-submit").click();
  await expect(page.getByTestId("forgot-password-sent")).toContainText("Check your inbox");
  await page.getByTestId("back-to-login").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("reset page checks the passwords match before sending", async ({ page }) => {
  await page.goto("/reset-password?token=not-a-real-token");
  await page.getByTestId("reset-password-input").fill("longenough1");
  await page.getByTestId("reset-password-confirm").fill("different99");
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("confirm-password-error")).toBeVisible();
  await page.goto("/reset-password");
  await expect(page.getByTestId("reset-password-missing")).toBeVisible();
});

test("brand text and errors follow the language switcher", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  await page.getByTestId("language-select").selectOption("hi");
  await expect(page.getByTestId("auth-footer")).toContainText("छात्रों के लिए मुफ़्त");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("email-error")).toHaveText("अपना ईमेल पता डालें।");
  await page.getByTestId("language-select").selectOption("bn");
  await expect(page.getByTestId("auth-footer")).toContainText("ছাত্রছাত্রীদের জন্য বিনামূল্যে");
  await expect(page.getByTestId("email-error")).toHaveText("আপনার ইমেল ঠিকানা দিন।");
  await page.getByTestId("language-select").selectOption("en");
});

test("guest join stays one click away", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("continue-as-guest").click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 });
});
