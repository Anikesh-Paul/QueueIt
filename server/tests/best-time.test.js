import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { resetClock, setNow } from "../src/services/clock.js";
import {
  bucketJoinTimes,
  busynessJson,
  formatCampusHourLabel,
  resolveQuietHint,
} from "../src/services/bestTime.js";

function ist(iso) {
  return new Date(iso);
}

async function createAdmin(app) {
  const password = "password123";
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword(password),
    role: "admin",
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function insertJoins(queueId, instants) {
  for (const instant of instants) {
    const createdAt = instant instanceof Date ? instant : new Date(instant);
    const entry = await QueueEntry.create({
      queue: queueId,
      user: (
        await User.create({
          email: `busy-${Math.random().toString(36).slice(2, 10)}@example.com`,
          name: "History User",
          passwordHash: await User.hashPassword("password123"),
        })
      )._id,
      tokenNumber: Math.floor(Math.random() * 100_000) + 1,
      status: "served",
    });
    await QueueEntry.collection.updateOne({ _id: entry._id }, { $set: { createdAt, updatedAt: createdAt } });
  }
}

describe("bestTime helpers", () => {
  it("buckets joins by campus weekday and hour, including midnight IST", () => {
    const { hours, total } = bucketJoinTimes([
      ist("2026-11-11T00:20:00+05:30"), // Wed 0
      ist("2026-11-10T23:50:00+05:30"), // Tue 23
      ist("2026-11-10T18:30:00+00:00"), // Wed 00:00 IST
    ]);
    assert.equal(total, 3);
    assert.equal(hours[3][0], 2);
    assert.equal(hours[2][23], 1);
  });

  it("formats campus hours in 12-hour labels", () => {
    assert.equal(formatCampusHourLabel(0), "12 AM");
    assert.equal(formatCampusHourLabel(15), "3 PM");
    assert.equal(formatCampusHourLabel(12), "12 PM");
  });

  it("does not invent a quiet hour when history is thin or flat", () => {
    const thin = Array.from({ length: 7 }, () => Array(24).fill(0));
    thin[3][10] = 4;
    thin[3][15] = 3;
    assert.deepEqual(resolveQuietHint(thin), { available: false, reason: "low-data" });

    const flat = Array.from({ length: 7 }, () => Array(24).fill(0));
    flat[1][9] = 4;
    flat[1][10] = 4;
    flat[1][11] = 4;
    assert.equal(resolveQuietHint(flat).available, false);
  });

  it("names the quietest observed hour and prefers today's weekday when that day has enough data", () => {
    const hours = Array.from({ length: 7 }, () => Array(24).fill(0));
    // Wednesday (today): quiet at 15
    hours[3][10] = 5;
    hours[3][12] = 4;
    hours[3][15] = 2;
    // Monday is quietest overall at 9 AM, but should be ignored when Wednesday qualifies
    hours[1][9] = 1;
    hours[1][10] = 8;
    hours[1][15] = 8;
    const hint = resolveQuietHint(hours, { weekday: 3 });
    assert.equal(hint.available, true);
    assert.equal(hint.hour, 15);
    assert.equal(hint.label, "3 PM");
    assert.equal(hint.scope, "weekday");
    assert.equal(busynessJson(hours, { weekday: 3 }).quietHint.label, "3 PM");
  });

  it("never claims an unobserved hour is quiet", () => {
    const hours = Array.from({ length: 7 }, () => Array(24).fill(0));
    hours[3][10] = 5;
    hours[3][12] = 4;
    hours[3][15] = 2;
    const hint = resolveQuietHint(hours, { weekday: 3 });
    assert.equal(hint.hour, 15);
    assert.notEqual(hint.hour, 3);
  });

  it("ignores a single stray arrival so it cannot become the quiet hour", () => {
    const hours = Array.from({ length: 7 }, () => Array(24).fill(0));
    hours[4][0] = 1;
    hours[4][10] = 10;
    hours[4][12] = 8;
    hours[4][15] = 4;
    const hint = resolveQuietHint(hours, { weekday: 4 });
    assert.equal(hint.available, true);
    assert.equal(hint.hour, 15);
    assert.notEqual(hint.hour, 0);
  });
});

describe("best time to come API", () => {
  const app = testApp();

  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    resetClock();
    await teardownTestDb();
  });

  beforeEach(async () => {
    resetClock();
    await resetDb();
    await seedVenueAndQueues();
  });

  it("hides the student hint and reports low history until enough varied joins exist", async () => {
    setNow(ist("2026-11-11T16:00:00+05:30"));
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    await insertJoins(cafeteria._id, [
      ist("2026-11-11T10:00:00+05:30"),
      ist("2026-11-11T15:00:00+05:30"),
    ]);

    const catalog = await request(app).get("/api/queues");
    assert.equal(catalog.status, 200);
    const card = catalog.body.queues.find((row) => row.id === cafeteria._id.toString());
    assert.equal(card.quietHint, null);

    const adminToken = await createAdmin(app);
    const analytics = await request(app)
      .get(`/api/admin/queues/${cafeteria._id}/analytics`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(analytics.status, 200);
    assert.equal(analytics.body.busyness.quietHint, null);
    assert.equal(analytics.body.busyness.total, 2);
    assert.equal(analytics.body.busyness.days.length, 7);
    assert.equal(analytics.body.busyness.days[0].hours.length, 24);
    assert.equal(JSON.stringify(analytics.body.busyness).includes("@"), false);
  });

  it("attaches a catalog quiet hint and analytics chart from IST join times, ignoring stale rows", async () => {
    setNow(ist("2026-11-11T16:00:00+05:30"));
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });

    await insertJoins(cafeteria._id, [
      ...Array.from({ length: 5 }, () => ist("2026-11-11T10:15:00+05:30")),
      ...Array.from({ length: 4 }, () => ist("2026-11-11T12:15:00+05:30")),
      ...Array.from({ length: 2 }, () => ist("2026-11-11T15:15:00+05:30")),
      // 61 days old — outside the usual window
      ist("2026-09-10T03:15:00+05:30"),
    ]);
    await insertJoins(gym._id, [ist("2026-11-11T09:00:00+05:30")]);

    const catalog = await request(app).get("/api/queues");
    assert.equal(catalog.status, 200);
    const cafeCard = catalog.body.queues.find((row) => row.id === cafeteria._id.toString());
    const gymCard = catalog.body.queues.find((row) => row.id === gym._id.toString());
    assert.equal(cafeCard.quietHint.label, "3 PM");
    assert.equal(cafeCard.quietHint.hour, 15);
    assert.equal(gymCard.quietHint, null);

    const adminToken = await createAdmin(app);
    const analytics = await request(app)
      .get(`/api/admin/queues/${cafeteria._id}/analytics`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(analytics.status, 200);
    assert.equal(analytics.body.busyness.quietHint.label, "3 PM");
    assert.equal(analytics.body.busyness.total, 11);
    const wednesday = analytics.body.busyness.days.find((day) => day.weekday === 3);
    assert.equal(wednesday.hours[10], 5);
    assert.equal(wednesday.hours[15], 2);
    assert.equal(wednesday.hours[3], 0);
  });
});
