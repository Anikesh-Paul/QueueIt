import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { resetClock } from "../src/services/clock.js";

async function registerUser(app, email = "waiter@example.com", name = "Priya Shah") {
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

describe("Public now-serving display board", () => {
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

  it("is public, shows honest now-serving, and never includes student PII", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const { token } = await registerUser(app);
    const join = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(join.status, 201);

    const before = await request(app).get(`/api/queues/${queueId}/board`);
    assert.equal(before.status, 200);
    assert.equal(before.body.queue.id, queueId);
    assert.equal(before.body.queue.name, "Cafeteria");
    assert.equal(before.body.queue.waitingCount, 1);
    assert.equal(before.body.queue.counters[0].nowServing, null);
    const rawBefore = JSON.stringify(before.body);
    assert.doesNotMatch(rawBefore, /Priya Shah/i);
    assert.doesNotMatch(rawBefore, /waiter@example.com/i);
    assert.doesNotMatch(rawBefore, /"email"/i);

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);

    const after = await request(app).get(`/api/queues/${queueId}/board`);
    assert.equal(after.status, 200);
    assert.equal(after.body.queue.counters[0].nowServing, join.body.tokenNumber);
    assert.equal(after.body.queue.waitingCount, 1);
    const rawAfter = JSON.stringify(after.body);
    assert.doesNotMatch(rawAfter, /Priya Shah/i);
    assert.doesNotMatch(rawAfter, /waiter@example.com/i);
  });

  it("returns 404 for an unknown or archived queue", async () => {
    await seedVenueAndQueues();
    const app = testApp();
    const missing = await request(app).get("/api/queues/aaaaaaaaaaaaaaaaaaaaaaaa/board");
    assert.equal(missing.status, 404);
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    cafeteria.archivedAt = new Date();
    await cafeteria.save();
    const archived = await request(app).get(`/api/queues/${cafeteria._id.toString()}/board`);
    assert.equal(archived.status, 404);
  });
});
