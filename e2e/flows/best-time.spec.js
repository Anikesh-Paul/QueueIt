import { test, expect } from "@playwright/test";
import mongoose from "mongoose";
import { API, queueByName } from "./helpers.js";

const E2E_DB = process.env.MONGODB_URI_E2E?.trim() || "mongodb://127.0.0.1:27017/queueit-e2e";
const IST_MS = 330 * 60_000;

/** Weekday (0 = Sun) on the campus clock. */
function campusWeekday(at = new Date()) {
  return new Date(at.getTime() + IST_MS).getUTCDay();
}

/** Past served walk-ins on one weekday (the API can't back-date tickets). */
async function insertHistory(queueId, weekday) {
  const perHour = { 17: 2, 18: 6, 19: 5, 20: 1 };
  const conn = await mongoose.createConnection(E2E_DB).asPromise();
  try {
    const docs = [];
    const todayIst = new Date(Date.now() + IST_MS);
    todayIst.setUTCHours(0, 0, 0, 0);
    let token = 9000;
    for (let back = 1; back <= 28; back += 1) {
      const day = new Date(todayIst.getTime() - back * 86_400_000);
      if (day.getUTCDay() !== weekday) continue;
      for (const [hour, n] of Object.entries(perHour)) {
        for (let i = 0; i < n; i += 1) {
          const createdAt = new Date(day.getTime() - IST_MS + Number(hour) * 3_600_000 + i * 5 * 60_000);
          const wait = n * 2 + i;
          token += 1;
          docs.push({
            queue: new mongoose.Types.ObjectId(queueId),
            user: null,
            guest: null,
            isWalkIn: true,
            walkInName: "e2e-best-time",
            tokenNumber: token,
            waitOrder: token * 1000,
            status: "served",
            calledAt: new Date(createdAt.getTime() + wait * 60_000),
            servedAt: new Date(createdAt.getTime() + (wait + 2) * 60_000),
            createdAt,
            updatedAt: createdAt,
          });
        }
      }
    }
    await conn.collection("queueentries").insertMany(docs);
  } finally {
    await conn.close();
  }
}

test("Best time to come: public chart, weekday picker, table and not-enough state", async ({ page, request }) => {
  const gym = await queueByName(request, "Gym");
  const today = campusWeekday();
  // A weekday other than today, so nothing earlier in the run has it cached.
  const target = (today + 3) % 7;
  await insertHistory(gym.id, target);

  // Public, read-only, briefly cacheable.
  const res = await request.get(`${API}/api/queues/${gym.id}/best-time?weekday=${target}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("max-age=");
  const body = await res.json();
  expect(body.enough).toBe(true);
  expect(body.best.hour).toBe(20);
  expect(body.hours.filter((h) => h.open).map((h) => h.hour)).toEqual(expect.arrayContaining([17, 18, 19, 20]));
  expect((await request.get(`${API}/api/queues/${gym.id}/best-time?weekday=9`)).status()).toBe(400);
  const summary = await request.get(`${API}/api/queues/best-time`);
  expect(summary.status()).toBe(200);
  expect((await summary.json()).queues.some((q) => q.queueId === gym.id)).toBe(true);

  // A weekday with no history for this queue (checked through the API first).
  let thin = null;
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    if (d === target) continue;
    const r = await (await request.get(`${API}/api/queues/${gym.id}/best-time?weekday=${d}`)).json();
    if (!r.enough) {
      thin = d;
      break;
    }
  }

  // No sign-in: the join page is public.
  await page.goto(`/join/${gym.id}`);
  const card = page.getByTestId("best-time-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId(`best-time-day-${today}`)).toHaveAttribute("aria-pressed", "true");

  await card.getByTestId(`best-time-day-${target}`).click();
  await expect(card.getByTestId(`best-time-day-${target}`)).toHaveAttribute("aria-pressed", "true");
  const chart = card.getByTestId("best-time-chart");
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute("role", "img");
  await expect(card.getByTestId("best-time-best-bar")).toHaveCount(1);
  await expect(card.getByTestId("best-time-summary")).toContainText(/8\s*pm/i);
  await expect(card.getByTestId("best-time-basis")).toBeVisible();

  // Text/table alternative.
  await card.getByTestId("best-time-table").locator("summary").click();
  await expect(card.getByTestId("best-time-row").first()).toBeVisible();
  expect(await card.getByTestId("best-time-row").count()).toBeGreaterThanOrEqual(4);

  if (thin !== null) {
    await card.getByTestId(`best-time-day-${thin}`).click();
    await expect(card.getByTestId("best-time-empty")).toBeVisible();
    await expect(card.getByTestId("best-time-chart")).toHaveCount(0);
  }
});
