import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";

/**
 * Ticket 04 — Live-status wait utility (status payload inputs for pace + clock ETA).
 * Seam: queue HTTP status (etaMinutes is position × effective pace; closed/pause honesty).
 * With no recent serves the pace is the configured averageServiceTime.
 * Campus-clock presentation is client present layer (see client/src/lib/campus-time.test.js).
 */

async function registerUser(app, email = "waiter@example.com", name = "Waiter") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function createAdmin(app) {
  const password = "password123";
  const passwordHash = await User.hashPassword(password);
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash,
    role: "admin",
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function seedAndGetCafeteriaId() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria._id.toString();
}

describe("Live-status wait utility (HTTP status payload)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("status exposes position, averageServiceTime, and etaMinutes (configured pace when data is thin)", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const tokenA = await registerUser(app, "a@example.com", "A");
    const tokenB = await registerUser(app, "b@example.com", "B");

    await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${tokenA}`);
    await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${tokenB}`);

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${tokenB}`);

    assert.equal(status.status, 200);
    // Pace inputs: people ahead = position − 1; ~avg min each.
    assert.equal(status.body.position, 2);
    assert.equal(status.body.averageServiceTime, 3);
    assert.equal(status.body.etaServiceTime, 3);
    assert.equal(status.body.etaPaceSource, "configured");
    // Product rule uses the effective pace; fallback is the configured average.
    assert.equal(status.body.etaMinutes, 2 * 3);
    assert.equal(
      status.body.etaMinutes,
      status.body.position * status.body.etaServiceTime
    );
  });

  it("status keeps Closed + pause honesty fields while joiner is still waiting (drain)", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const adminToken = await createAdmin(app);
    const userToken = await registerUser(app);

    await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${userToken}`);

    await request(app)
      .post(`/api/admin/queues/${queueId}/stop-accepting`)
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .post(`/api/admin/queues/${queueId}/pause`)
      .set("Authorization", `Bearer ${adminToken}`);

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${userToken}`);

    assert.equal(status.status, 200);
    assert.equal(status.body.status, "waiting");
    assert.equal(status.body.queue.acceptingTokens, false);
    assert.equal(status.body.queue.status, "paused");
    // ETA minutes still computed; client freezes clock presentation while paused.
    assert.equal(status.body.etaMinutes, 1 * 3);
    assert.equal(typeof status.body.averageServiceTime, "number");
  });

  it("Guest status carries the same wait-utility inputs as User", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();

    const join = await request(app).post(`/api/queues/${queueId}/join`);
    assert.equal(join.status, 201);
    const guestCred = join.body.guestCredential;
    assert.equal(typeof guestCred, "string");

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("X-Guest-Credential", guestCred);

    assert.equal(status.status, 200);
    assert.equal(status.body.position, 1);
    assert.equal(status.body.etaPaceSource, "configured");
    assert.equal(
      status.body.etaMinutes,
      status.body.position * status.body.etaServiceTime
    );
    assert.equal(typeof status.body.queue.acceptingTokens, "boolean");
    assert.ok(["open", "paused"].includes(status.body.queue.status));
  });

  it("uses the recent inter-serve average for ETA once enough campus-day serves exist", async () => {
    const { setNow, resetClock } = await import("../src/services/clock.js");
    const { QueueEntry } = await import("../src/models/QueueEntry.js");
    const { User } = await import("../src/models/User.js");
    // Mid-morning IST on 11 Nov 2026 (05:00 UTC).
    setNow("2026-11-11T05:00:00.000Z");
    try {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const start = new Date("2026-11-11T04:00:00.000Z");
      for (const minutes of [0, 2, 4, 6]) {
        const servedAt = new Date(start.getTime() + minutes * 60_000);
        const user = await User.create({
          email: `pace-${minutes}@example.com`,
          name: "Pace",
          passwordHash: await User.hashPassword("password123"),
        });
        const entry = await QueueEntry.create({
          queue: queueId,
          user: user._id,
          isWalkIn: false,
          tokenNumber: minutes + 1,
          status: "served",
        });
        await QueueEntry.collection.updateOne(
          { _id: entry._id },
          { $set: { createdAt: start, updatedAt: servedAt } }
        );
      }

      const token = await registerUser(app, "waiter-pace@example.com", "Waiter");
      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${token}`);
      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(status.status, 200);
      assert.equal(status.body.averageServiceTime, 3);
      assert.equal(status.body.etaPaceSource, "recent");
      assert.equal(status.body.etaServiceTime, 2);
      assert.equal(status.body.position, 1);
      assert.equal(status.body.etaMinutes, 2);
    } finally {
      resetClock();
    }
  });

  it("ignores yesterday's serves when resolving today's pace", async () => {
    const { setNow, resetClock } = await import("../src/services/clock.js");
    const { QueueEntry } = await import("../src/models/QueueEntry.js");
    const { User } = await import("../src/models/User.js");
    setNow("2026-11-11T05:00:00.000Z");
    try {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const yesterday = new Date("2026-11-10T08:00:00.000Z");
      for (const minutes of [0, 10, 20, 30]) {
        const servedAt = new Date(yesterday.getTime() + minutes * 60_000);
        const user = await User.create({
          email: `old-pace-${minutes}@example.com`,
          name: "Old",
          passwordHash: await User.hashPassword("password123"),
        });
        const entry = await QueueEntry.create({
          queue: queueId,
          user: user._id,
          isWalkIn: false,
          tokenNumber: minutes + 50,
          status: "served",
        });
        await QueueEntry.collection.updateOne(
          { _id: entry._id },
          { $set: { createdAt: yesterday, updatedAt: servedAt } }
        );
      }

      const token = await registerUser(app, "waiter-old@example.com", "Waiter");
      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${token}`);
      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(status.status, 200);
      assert.equal(status.body.etaPaceSource, "configured");
      assert.equal(status.body.etaServiceTime, 3);
      assert.equal(status.body.etaMinutes, 3);
    } finally {
      resetClock();
    }
  });
});
