import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { setNow, advanceMs, resetClock } from "../src/services/clock.js";

async function login(app, email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function createAdmin(app) {
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword("password123"),
    role: "admin",
  });
  return login(app, "admin@example.com", "password123");
}

async function register(app, email, name = "Student") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function joinAs(app, token, queueId) {
  const res = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  assert.equal(res.status, 201);
  return res.body;
}

describe("Missed-turn recovery", () => {
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

  it("lets a skipped student rejoin within the window, N places behind, once", async () => {
    const { queues } = await seedVenueAndQueues();
    const queueId = queues.find((q) => q.slug === "cafeteria")._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await register(app, "first@example.com", "First");
    const a = await register(app, "a@example.com", "Ada");
    const b = await register(app, "b@example.com", "Bea");
    const c = await register(app, "c@example.com", "Cia");
    const d = await register(app, "d@example.com", "Dia");

    const skipped = await joinAs(app, first, queueId);
    const tokenA = (await joinAs(app, a, queueId)).tokenNumber;
    const tokenB = (await joinAs(app, b, queueId)).tokenNumber;
    const tokenC = (await joinAs(app, c, queueId)).tokenNumber;
    const tokenD = (await joinAs(app, d, queueId)).tokenNumber;

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});
    assert.equal(call.status, 200);
    assert.equal(call.body.called.tokenNumber, skipped.tokenNumber);

    const skip = await request(app)
      .post(`/api/admin/queues/${queueId}/skip`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});
    assert.equal(skip.status, 200);

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, "skipped");
    assert.equal(status.body.missedTurn, true);
    assert.equal(status.body.canRecover, true);
    assert.ok(status.body.recoverUntil);

    const active = await request(app)
      .get("/api/queues/active")
      .set("Authorization", `Bearer ${first}`);
    assert.equal(active.status, 200);
    assert.equal(active.body.memberships.length, 1);
    assert.equal(active.body.memberships[0].canRecover, true);

    const rejoin = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${first}`)
      .send({});
    assert.equal(rejoin.status, 200);
    assert.equal(rejoin.body.status, "waiting");
    assert.equal(rejoin.body.returning, true);
    assert.equal(rejoin.body.tokenNumber, skipped.tokenNumber);
    assert.equal(rejoin.body.position, 3);

    const waiting = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(waiting.status, 200);
    const waiters = waiting.body.waiting.filter((row) => row.status === "waiting");
    assert.deepEqual(
      waiters.map((row) => row.tokenNumber),
      [tokenA, tokenB, skipped.tokenNumber, tokenC, tokenD]
    );
    const returned = waiters.find((row) => row.tokenNumber === skipped.tokenNumber);
    assert.equal(returned.returning, true);
    assert.equal(returned.position, 3);

    const audit = await request(app)
      .get("/api/admin/audit")
      .query({ queueId })
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.some((row) => row.action === "rejoin"));
  });

  it("rejects a second recovery, a manual leave, and an expired window", async () => {
    const { queues } = await seedVenueAndQueues();
    const queueId = queues.find((q) => q.slug === "cafeteria")._id.toString();
    await Queue.findByIdAndUpdate(queueId, { recoveryMinutes: 15, recoveryPlaces: 2 });
    const app = testApp();
    const admin = await createAdmin(app);

    const leftUser = await register(app, "left@example.com", "Leaver");
    await joinAs(app, leftUser, queueId);
    const leave = await request(app)
      .post(`/api/queues/${queueId}/leave`)
      .set("Authorization", `Bearer ${leftUser}`)
      .send({});
    assert.equal(leave.status, 200);
    const leftRejoin = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${leftUser}`)
      .send({});
    assert.equal(leftRejoin.status, 409);
    assert.match(leftRejoin.body.error, /left/i);

    setNow("2026-03-01T09:00:00.000Z");
    const twice = await register(app, "twice@example.com", "Twice");
    const mid = await register(app, "mid@example.com", "Mid");
    await joinAs(app, twice, queueId);
    await joinAs(app, mid, queueId);
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/queues/${queueId}/call`)
          .set("Authorization", `Bearer ${admin}`)
          .send({})
      ).status,
      200
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/queues/${queueId}/skip`)
          .set("Authorization", `Bearer ${admin}`)
          .send({})
      ).status,
      200
    );
    const firstRejoin = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${twice}`)
      .send({});
    assert.equal(firstRejoin.status, 200);

    assert.equal(
      (
        await request(app)
          .post(`/api/admin/queues/${queueId}/call`)
          .set("Authorization", `Bearer ${admin}`)
          .send({ entryId: (await QueueEntry.findOne({ tokenNumber: firstRejoin.body.tokenNumber, queue: queueId }))._id.toString() })
      ).status,
      200
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/queues/${queueId}/skip`)
          .set("Authorization", `Bearer ${admin}`)
          .send({})
      ).status,
      200
    );
    const second = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${twice}`)
      .send({});
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already used/i);

    const late = await register(app, "late@example.com", "Late");
    await joinAs(app, late, queueId);
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/queues/${queueId}/call`)
          .set("Authorization", `Bearer ${admin}`)
          .send({ entryId: (await QueueEntry.findOne({ user: (await User.findOne({ email: "late@example.com" }))._id, queue: queueId, status: { $in: ["waiting", "serving"] } }))._id.toString() })
      ).status,
      200
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/admin/queues/${queueId}/skip`)
          .set("Authorization", `Bearer ${admin}`)
          .send({})
      ).status,
      200
    );
    advanceMs(15 * 60 * 1000);
    const expired = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${late}`)
      .send({});
    assert.equal(expired.status, 409);
    assert.match(expired.body.error, /no longer rejoin/i);
  });

  it("lets an admin edit the recovery window and places", async () => {
    const { queues } = await seedVenueAndQueues();
    const queueId = queues.find((q) => q.slug === "cafeteria")._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const updated = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ recoveryMinutes: 20, recoveryPlaces: 3 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.queue.recoveryMinutes, 20);
    assert.equal(updated.body.queue.recoveryPlaces, 3);
    const bad = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ recoveryMinutes: 0 });
    assert.equal(bad.status, 400);
  });
});
