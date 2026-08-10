import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";

/**
 * Ticket 04 — Live-status wait utility (status payload inputs for pace + clock ETA).
 * Seam: queue HTTP status (etaMinutes stays position × averageServiceTime; closed/pause honesty).
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

  it("status exposes position, averageServiceTime, and etaMinutes (no new ETA formula)", async () => {
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
    // Unchanged product rule — present layer only reformats.
    assert.equal(status.body.etaMinutes, 2 * 3);
    assert.equal(
      status.body.etaMinutes,
      status.body.position * status.body.averageServiceTime
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
    assert.equal(
      status.body.etaMinutes,
      status.body.position * status.body.averageServiceTime
    );
    assert.equal(typeof status.body.queue.acceptingTokens, "boolean");
    assert.ok(["open", "paused"].includes(status.body.queue.status));
  });
});
