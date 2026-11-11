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

describe("I'm here check-in", () => {
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

  it("flags the called student, stops the no-show auto-skip, and is idempotent", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await joinAs(app, queueId, "a@example.com");
    await joinAs(app, queueId, "b@example.com");

    const waitingCheckin = await request(app)
      .post(`/api/queues/${queueId}/here`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(waitingCheckin.status, 409);

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);

    const here = await request(app)
      .post(`/api/queues/${queueId}/here`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(here.status, 200);
    assert.equal(here.body.status, "serving");
    assert.equal(here.body.here, true);
    assert.ok(here.body.arrivedAt);
    assert.equal(here.body.servingDeadlineAt, null);
    assert.equal(here.body.servingRemainingSeconds, null);

    const again = await request(app)
      .post(`/api/queues/${queueId}/here`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(again.status, 200);
    assert.equal(again.body.arrivedAt, here.body.arrivedAt);

    const waiting = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(waiting.status, 200);
    const called = waiting.body.waiting.find((row) => row.status === "serving");
    assert.equal(called.here, true);
    assert.equal(called.tokenNumber, first.join.tokenNumber);

    // Deadline is gone, so advancing past the original no-show window must not auto-skip.
    advanceMs(5 * 60_000);
    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, "serving");
    assert.equal(status.body.here, true);

    const still = await QueueEntry.findById(called.id);
    assert.equal(still.status, "serving");
  });
});
