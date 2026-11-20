import { test, expect } from "@playwright/test";
import mongoose from "mongoose";
import { API, ensureOpen, queueByName, registerStudent, signIn, tokens } from "./helpers.js";

const E2E_DB = process.env.MONGODB_URI_E2E?.trim() || "mongodb://127.0.0.1:27017/queueit-e2e";

async function userIdOf(request, token) {
  const me = await (await request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return me.user.id;
}

/** Older tickets straight into the local e2e database (the API has no back-dating). */
async function insertPastVisits(userId, queueId, count) {
  const conn = await mongoose.createConnection(E2E_DB).asPromise();
  try {
    const docs = Array.from({ length: count }, (_, i) => {
      const createdAt = new Date(Date.UTC(2026, 9, 1 + i, 6, 0, 0)); // 1–N Oct 2026
      const calledAt = new Date(createdAt.getTime() + (5 + i) * 60_000);
      return {
        queue: new mongoose.Types.ObjectId(queueId),
        user: new mongoose.Types.ObjectId(userId),
        guest: null,
        isWalkIn: false,
        tokenNumber: 7000 + i,
        waitOrder: (7000 + i) * 1000,
        status: "served",
        calledAt,
        servedAt: new Date(calledAt.getTime() + 3 * 60_000),
        createdAt,
        updatedAt: createdAt,
      };
    });
    await conn.collection("queueentries").insertMany(docs);
  } finally {
    await conn.close();
  }
}

test("My visits: stats, outcomes, feedback, filters and pages", async ({ page, request }) => {
  const { admin } = tokens();
  const adminHeaders = { Authorization: `Bearer ${admin}` };
  const gym = await queueByName(request, "Gym");
  const cafeteria = await queueByName(request, "Cafeteria");
  await ensureOpen(request, admin, gym.id);
  await ensureOpen(request, admin, cafeteria.id);
  const student = await registerStudent(request, "visits");
  const headers = { Authorization: `Bearer ${student}` };

  // Served at the Gym, then rated.
  const join = await request.post(`${API}/api/queues/${gym.id}/join`, { headers });
  expect(join.status()).toBe(201);
  const { tokenNumber } = await join.json();
  const list = await (await request.get(`${API}/api/admin/queues/${gym.id}/waiting-list`, { headers: adminHeaders })).json();
  const row = list.waiting.find((w) => w.tokenNumber === tokenNumber);
  expect((await request.post(`${API}/api/admin/queues/${gym.id}/serve`, { headers: adminHeaders, data: { entryId: row.id } })).status()).toBe(200);
  // Joined the Cafeteria and left.
  expect((await request.post(`${API}/api/queues/${cafeteria.id}/join`, { headers })).status()).toBe(201);
  expect((await request.post(`${API}/api/queues/${cafeteria.id}/leave`, { headers })).status()).toBe(200);

  await signIn(page, student);
  await page.goto("/queues");
  await page.getByTestId("shell-nav").getByTestId("nav-history").click();
  await expect(page.getByTestId("history-heading")).toHaveText("My visits");
  await expect(page.getByTestId("visit-item")).toHaveCount(2);
  await expect(page.getByTestId("visits-stat-total-value")).toHaveText("2");
  await expect(page.getByTestId("visits-stat-served-value")).toHaveText("1");
  await expect(page.locator('[data-testid="visit-item"][data-outcome="left"]')).toContainText("Cafeteria");
  const served = page.locator('[data-testid="visit-item"][data-outcome="served"]');
  await expect(served).toContainText("Gym");
  await expect(served.getByTestId("visit-wait")).toContainText("Waited");

  // Rate from the visit row.
  await served.getByTestId("history-rate").click();
  await served.getByTestId("feedback-star-4").click();
  await served.getByTestId("history-feedback-send").click();
  await expect(served.getByTestId("history-rated")).toBeVisible();

  // Filter by queue.
  await page.getByTestId("visits-filter-queue").selectOption({ label: "Gym" });
  await expect(page).toHaveURL(new RegExp(`queue=${gym.id}`));
  await expect(page.getByTestId("visit-item")).toHaveCount(1);
  await expect(page.getByTestId("visits-stat-total")).toContainText("Matching your filters");

  // A backwards range explains itself; a range with nothing in it says so.
  await page.getByTestId("visits-filter-clear").click();
  await page.getByTestId("visits-filter-from").fill("2026-11-10");
  await page.getByTestId("visits-filter-to").fill("2026-11-01");
  await expect(page.getByTestId("visits-range-error")).toBeVisible();
  await page.getByTestId("visits-filter-from").fill("2020-01-01");
  await page.getByTestId("visits-filter-to").fill("2020-01-31");
  await expect(page.getByTestId("visits-no-match")).toBeVisible();
  await page.getByTestId("visits-filter-clear").click();

  // Older tickets → three pages; the list follows the page buttons.
  await insertPastVisits(await userIdOf(request, student), cafeteria.id, 12);
  await page.getByTestId("history-refresh").click();
  await expect(page.getByTestId("visits-stat-total-value")).toHaveText("14");
  await expect(page.getByTestId("visits-range")).toHaveText("Showing 1–10 of 14");
  await page.getByTestId("visits-page-next").click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByTestId("visit-item")).toHaveCount(4);
  await expect(page.getByTestId("visits-page-2")).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page.getByTestId("visit-item")).toHaveCount(10);

  // October only, through the URL.
  await page.goto("/history?from=2026-10-01&to=2026-10-05");
  await expect(page.getByTestId("visit-item")).toHaveCount(5);
});

test("starred queues pin to the top and stay starred after a reload", async ({ page, request }) => {
  const student = await registerStudent(request, "stars");
  await signIn(page, student);
  await page.goto("/queues");
  const cards = page.getByTestId("queue-card");
  await expect(cards.first()).toBeVisible();
  const names = await page.locator('[data-testid="queue-card"] .font-heading').allTextContents();
  expect(names.length).toBeGreaterThan(1);
  const last = names.at(-1);

  const star = page.getByRole("button", { name: `Star ${last}` });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(cards.first()).toContainText(last);

  await page.reload();
  await expect(page.getByTestId("queue-card").first()).toContainText(last);
  await expect(page.getByRole("button", { name: `Star ${last}` })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: `Star ${last}` }).click();
  await expect(page.getByRole("button", { name: `Star ${last}` })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("queue-card").first()).toContainText(names[0]);
});

test("guests keep device history and see no stars", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("continue-as-guest").click();
  await page.goto("/queues");
  await expect(page.getByTestId("queue-card").first()).toBeVisible();
  await expect(page.getByTestId("queue-star")).toHaveCount(0);
  await expect(page.getByTestId("shell-nav").getByTestId("nav-history")).toHaveText("History");
  await page.goto("/history");
  await expect(page.getByTestId("history-heading")).toHaveText("History");
  await expect(page.getByTestId("visits-summary")).toHaveCount(0);
});

test("the visits API only answers for the signed-in account", async ({ request }) => {
  expect((await request.get(`${API}/api/me/visits`)).status()).toBe(401);
  const a = await registerStudent(request, "scope-a");
  const res = await request.get(`${API}/api/me/visits`, { headers: { Authorization: `Bearer ${a}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect((await res.json()).total).toBe(0);
});
