import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { setNow, advanceMs, resetClock } from "../src/services/clock.js";

async function registerUser(app, email = "waiter@example.com", name = "Waiter") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return { token: res.body.token, user: res.body.user };
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

async function seedQueue() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  cafeteria.noShowMinutes = 1;
  await cafeteria.save();
  return cafeteria._id.toString();
}

async function joinAs(app, queueId, email) {
  const { token } = await registerUser(app, email, email.split("@")[0]);
  const res = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 201);
  return { token, join: res.body };
}

describe("Call / serving no-show timer", () => {
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
  });

  it("calls the next waiter to serving, sets nowServing, and starts a deadline", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await joinAs(app, queueId, "a@example.com");
    await joinAs(app, queueId, "b@example.com");

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);
    assert.equal(call.body.called.tokenNumber, 1);
    assert.equal(call.body.called.status, "serving");
    assert.equal(call.body.queue.nowServing, 1);
    assert.ok(call.body.called.servingDeadlineAt);

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, "serving");
    assert.equal(status.body.position, 0);
    assert.equal(status.body.servingTimerFrozen, false);
    assert.ok(status.body.servingRemainingSeconds > 0);
    assert.ok(status.body.servingRemainingSeconds <= 60);

    const list = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(list.body.waiting[0].status, "serving");
    assert.equal(list.body.waiting[0].tokenNumber, 1);
    assert.equal(list.body.waiting[0].position, 0);
    assert.equal(list.body.waiting[1].status, "waiting");
    assert.equal(list.body.waiting[1].position, 1);
  });

  it("rejects a second call while someone is already being called", async () => {
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    await joinAs(app, queueId, "a@example.com");
    await joinAs(app, queueId, "b@example.com");

    const first = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(first.status, 200);

    const second = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(second.status, 409);
    assert.ok(/already being called/i.test(second.body.error));
  });

  it("serves a called entry, and can still serve a waiting entry immediately", async () => {
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    await joinAs(app, queueId, "a@example.com");
    await joinAs(app, queueId, "b@example.com");

    await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);

    const serveCalled = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(serveCalled.status, 200);
    assert.equal(serveCalled.body.served.tokenNumber, 1);
    assert.equal(serveCalled.body.served.status, "served");

    const stillWaiting = await QueueEntry.findOne({ queue: queueId, status: "waiting" });
    assert.equal(stillWaiting.tokenNumber, 2);

    const serveImmediate = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(serveImmediate.status, 200);
    assert.equal(serveImmediate.body.served.tokenNumber, 2);
    assert.equal(serveImmediate.body.served.status, "served");
  });

  it("skips a called entry early", async () => {
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    await joinAs(app, queueId, "a@example.com");

    await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);

    const skip = await request(app)
      .post(`/api/admin/queues/${queueId}/skip`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(skip.status, 200);
    assert.equal(skip.body.skipped.status, "skipped");
    const leftover = await QueueEntry.findOne({ queue: queueId, status: "serving" });
    assert.equal(leftover, null);
  });

  it("auto-skips a no-show when the deadline passes (lazy on the next request)", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await joinAs(app, queueId, "a@example.com");

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);

    advanceMs(61_000);

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(status.status, 404);

    const entry = await QueueEntry.findOne({ queue: queueId, tokenNumber: 1 });
    assert.equal(entry.status, "skipped");
  });

  it("freezes the no-show timer while the queue is paused", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await joinAs(app, queueId, "a@example.com");

    await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);

    const pause = await request(app)
      .post(`/api/admin/queues/${queueId}/pause`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(pause.status, 200);

    advanceMs(5 * 60_000);

    const frozen = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(frozen.status, 200);
    assert.equal(frozen.body.status, "serving");
    assert.equal(frozen.body.servingTimerFrozen, true);
    assert.ok(frozen.body.servingRemainingSeconds <= 60);

    const resume = await request(app)
      .post(`/api/admin/queues/${queueId}/resume`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(resume.status, 200);

    const live = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(live.status, 200);
    assert.equal(live.body.status, "serving");
    assert.equal(live.body.servingTimerFrozen, false);

    advanceMs(61_000);
    const expired = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(expired.status, 404);
    const entry = await QueueEntry.findOne({ queue: queueId, tokenNumber: 1 });
    assert.equal(entry.status, "skipped");
  });

  it("rejects call while paused and allows call after resume", async () => {
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    await joinAs(app, queueId, "a@example.com");

    await request(app)
      .post(`/api/admin/queues/${queueId}/pause`)
      .set("Authorization", `Bearer ${admin}`);

    const pausedCall = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(pausedCall.status, 409);

    await request(app)
      .post(`/api/admin/queues/${queueId}/resume`)
      .set("Authorization", `Bearer ${admin}`);

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);
    assert.equal(call.body.called.status, "serving");
  });

  it("clears a called entry on reset", async () => {
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    await joinAs(app, queueId, "a@example.com");
    await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);

    const reset = await request(app)
      .post(`/api/admin/queues/${queueId}/reset`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(reset.status, 200);
    assert.ok(reset.body.cleared >= 1);
    const leftover = await QueueEntry.findOne({
      queue: queueId,
      status: { $in: ["waiting", "serving"] },
    });
    assert.equal(leftover, null);
  });
});
