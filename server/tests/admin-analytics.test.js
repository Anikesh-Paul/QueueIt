import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";

async function registerUser(app, email = "waiter@example.com", name = "Waiter") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return { token: res.body.token, user: res.body.user };
}

async function createAdmin(app, email = "admin@example.com", name = "Admin") {
  const password = "password123";
  const passwordHash = await User.hashPassword(password);
  await User.create({
    email,
    name,
    passwordHash,
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return { token: res.body.token, user: res.body.user };
}

async function seedAndGetCafeteriaId() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria._id.toString();
}

/**
 * Wall-clock hour in campus time (Asia/Kolkata) → UTC Date for storage.
 * Lands at :15 past the hour so the peak bucket is unambiguous.
 */
function servedAtInIstHour(hourIst) {
  const hh = String(Number(hourIst)).padStart(2, "0");
  return new Date(`2026-08-09T${hh}:15:00+05:30`);
}

/**
 * Insert a terminal QueueEntry with a fixed lifespan: servedAt (updatedAt)
 * and createdAt are back-dated via a raw updateOne so mongoose timestamps do
 * not override the story the test needs. App-joined entries get a real user;
 * walk-ins carry a name instead.
 *
 * `hourIst` is the campus-time hour bucket (Asia/Kolkata, 00–23). Storage is
 * still UTC; only the wall-clock intent is IST so peak labels stay stable.
 */
async function createServedEntry(queueId, { waitMinutes, hourIst, isWalkIn = false } = {}) {
  const servedAt =
    hourIst != null ? servedAtInIstHour(hourIst) : new Date(Date.now() - 60_000);
  const joinedAt = new Date(servedAt.getTime() - waitMinutes * 60_000);

  const entry = await QueueEntry.create({
    queue: queueId,
    user: isWalkIn ? null : (await User.create({
      email: `analytics-${Math.random().toString(36).slice(2, 10)}@example.com`,
      name: "Analytics User",
      passwordHash: await User.hashPassword("password123"),
    }))._id,
    isWalkIn,
    walkInName: isWalkIn ? "Counter Guest" : null,
    tokenNumber: Math.floor(Math.random() * 100_000) + 1,
    status: "served",
  });
  await QueueEntry.collection.updateOne(
    { _id: entry._id },
    { $set: { createdAt: joinedAt, updatedAt: servedAt } }
  );
  return entry;
}

/**
 * Stretch: admin analytics — served count, average wait, simple peaks.
 * GET /api/admin/queues/:queueId/analytics
 * Metrics: served/skipped/left/waiting counts, average + longest wait over
 * served entries (minutes), and the top 3 busiest hourly buckets (campus IST).
 */
describe("Admin analytics (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("role gates", () => {
    it("rejects unauthenticated and non-admin analytics", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const path = `/api/admin/queues/${queueId}/analytics`;

      assert.equal((await request(app).get(path)).status, 401);

      const { token: userToken } = await registerUser(app);
      assert.equal(
        (await request(app).get(path).set("Authorization", `Bearer ${userToken}`)).status,
        403
      );
    });
  });

  describe("GET /api/admin/queues/:queueId/analytics", () => {
    it("returns zeroed metrics for a fresh queue", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const res = await request(app)
        .get(`/api/admin/queues/${queueId}/analytics`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.queue.id, queueId);
      assert.equal(res.body.queue.name, "Cafeteria");
      assert.deepEqual(res.body.metrics, {
        servedCount: 0,
        skippedCount: 0,
        leftCount: 0,
        waitingCount: 0,
        averageWaitMinutes: null,
        longestWaitMinutes: null,
      });
      assert.deepEqual(res.body.peakHours, []);
    });

    it("counts served/skipped/left/waiting and averages wait over served entries", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      // Three served entries with 4, 6, 8 minute waits (one a walk-in).
      await createServedEntry(queueId, { waitMinutes: 4, hourIst: 10 });
      await createServedEntry(queueId, { waitMinutes: 6, hourIst: 10, isWalkIn: true });
      await createServedEntry(queueId, { waitMinutes: 8, hourIst: 11 });

      // One skipped, one left, two still waiting.
      await QueueEntry.create({
        queue: queueId,
        user: null,
        isWalkIn: true,
        walkInName: "Skipped Guest",
        tokenNumber: 104,
        status: "skipped",
      });
      await QueueEntry.create({
        queue: queueId,
        user: null,
        isWalkIn: true,
        walkInName: "Left Guest",
        tokenNumber: 105,
        status: "left",
      });
      await QueueEntry.create({
        queue: queueId,
        user: null,
        isWalkIn: true,
        walkInName: "Waiting One",
        tokenNumber: 106,
        status: "waiting",
      });
      await QueueEntry.create({
        queue: queueId,
        user: null,
        isWalkIn: true,
        walkInName: "Waiting Two",
        tokenNumber: 107,
        status: "waiting",
      });

      const res = await request(app)
        .get(`/api/admin/queues/${queueId}/analytics`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.deepEqual(res.body.metrics, {
        servedCount: 3,
        skippedCount: 1,
        leftCount: 1,
        waitingCount: 2,
        averageWaitMinutes: 6,
        longestWaitMinutes: 8,
      });
    });

    it("reports the busiest hours as a simple throughput peak", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      // Two serves in the 10:00 IST bucket, one each in 11:00 and 13:00 IST.
      await createServedEntry(queueId, { waitMinutes: 5, hourIst: 10 });
      await createServedEntry(queueId, { waitMinutes: 3, hourIst: 10 });
      await createServedEntry(queueId, { waitMinutes: 7, hourIst: 11 });
      await createServedEntry(queueId, { waitMinutes: 2, hourIst: 13 });

      const res = await request(app)
        .get(`/api/admin/queues/${queueId}/analytics`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.deepEqual(res.body.peakHours, [
        { label: "10:00 IST", served: 2 },
        { label: "11:00 IST", served: 1 },
        { label: "13:00 IST", served: 1 },
      ]);
      assert.equal(res.body.metrics.servedCount, 4);
    });

    it("returns 404 for an unknown queue", async () => {
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const res = await request(app)
        .get("/api/admin/queues/aaaaaaaaaaaaaaaaaaaaaaaa/analytics")
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(res.status, 404);
    });
  });
});
