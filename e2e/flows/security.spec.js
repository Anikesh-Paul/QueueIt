import { test, expect } from "@playwright/test";
import { API, queueByName, registerStudent, signIn, tokens } from "./helpers.js";
import { totp } from "./totp.js";

async function signInWithPassword(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("staff enroll in two-step sign-in, sign in with a code and a backup code, then turn it off", async ({ page, request }) => {
  const cafeteria = await queueByName(request, "Cafeteria");
  const email = `e2e-2fa-${Date.now()}@example.com`;
  const password = "staff-pass-123";
  const invite = await request.post(`${API}/api/admin/staff`, {
    headers: { Authorization: `Bearer ${tokens().admin}` },
    data: { name: "E2E Two Step", email, venueId: cafeteria.venue.id, temporaryPassword: password },
  });
  expect(invite.status()).toBe(201);

  await signInWithPassword(page, email, password);
  await expect(page.getByTestId("identity-chip")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("identity-chip").click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByTestId("two-step-state")).toHaveText("Off");

  // Enroll: password → QR + key → first code → backup codes.
  await page.getByTestId("two-step-start").click();
  await page.getByTestId("two-step-password").fill(password);
  await page.getByTestId("two-step-continue").click();
  await expect(page.getByTestId("two-step-qr").locator("svg")).toBeVisible();
  const secret = (await page.getByTestId("two-step-secret").innerText()).replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByTestId("two-step-confirm-code").fill(totp(secret));
  await page.getByTestId("two-step-enable").click();
  const codes = page.getByTestId("backup-code");
  await expect(codes).toHaveCount(10);
  const backup = await codes.allInnerTexts();
  await page.getByTestId("backup-codes-done").click();
  await expect(page.getByTestId("two-step-state")).toHaveText("On");
  await expect(page.getByTestId("two-step-summary")).toContainText("10 backup codes left");

  // Sign in again: password, then the next authenticator code.
  await page.getByTestId("shell-logout").click();
  await signInWithPassword(page, email, password);
  await expect(page.getByTestId("two-step-form")).toBeVisible();
  await page.getByTestId("two-step-code").fill("000000" === totp(secret, Date.now() + 30_000) ? "111111" : "000000");
  await page.getByTestId("two-step-submit").click();
  await expect(page.getByTestId("two-step-error")).toContainText("That code didn't work");
  await page.getByTestId("two-step-code").fill(totp(secret, Date.now() + 30_000));
  await page.getByTestId("two-step-submit").click();
  await expect(page.getByTestId("identity-chip")).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/login/);

  // A backup code works too (once) and points to making new ones.
  await page.getByTestId("shell-logout").click();
  await signInWithPassword(page, email, password);
  await page.getByTestId("two-step-toggle").click();
  await page.getByTestId("two-step-code").fill(backup[0]);
  await page.getByTestId("two-step-submit").click();
  await expect(page).toHaveURL(/\/security$/, { timeout: 15_000 });
  await expect(page.getByTestId("security-notice")).toContainText("You have 9 left");

  // Turning it off needs a current code (a backup code here).
  await page.getByTestId("two-step-disable").click();
  await page.getByTestId("two-step-current-code").fill(backup[1]);
  await page.getByTestId("two-step-confirm-action").click();
  await expect(page.getByTestId("two-step-state")).toHaveText("Off");

  // The audit log records both changes for global admins.
  const audit = await request.get(`${API}/api/admin/audit?category=security`, {
    headers: { Authorization: `Bearer ${tokens().admin}` },
  });
  const events = (await audit.json()).events.filter((e) => e.actor?.email === email).map((e) => e.action);
  expect(events).toEqual(expect.arrayContaining(["2fa-enabled", "2fa-disabled"]));
});

test("sign out of all devices ends every session", async ({ page, request }) => {
  const token = await registerStudent(request, "signout");
  // A second "device" for the same account.
  const me = await (await request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const other = await request.post(`${API}/api/auth/login`, { data: { email: me.user.email, password: "password123" } });
  const otherToken = (await other.json()).token;

  await signIn(page, token);
  await page.goto("/security");
  await expect(page.getByTestId("security-heading")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("two-step-card")).toHaveCount(0); // students: no 2FA card
  await page.getByTestId("sign-out-all").click();
  await page.getByTestId("sign-out-all-confirm").click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await expect(page.getByTestId("auth-notice")).toContainText("signed out of all devices");

  for (const t of [token, otherToken]) {
    const res = await request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
    expect(res.status()).toBe(401);
  }
});

test("a wrong password still gives the normal error", async ({ page }) => {
  await signInWithPassword(page, "user@queueit.local", "definitely-wrong");
  await expect(page.getByText("Invalid email or password")).toBeVisible();
});
