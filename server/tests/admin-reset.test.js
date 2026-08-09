import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
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

async function joinQueue(app, token, queueId) {
  const res = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 201);
  return res.body;
}

/**
 * Stretch: admin reset queue — end-of-session / day close.
 * POST /api/admin/queues/:queueId/reset
 * Clears the waiting list (entries closed as left), resets nowServing to null,
 * restarts tokens at 1, and re-opens the queue (works while paused).
 */
describe("Admin reset queue (HTTP API)", () => {
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
    it("rejects unauthenticated and non-admin reset", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const path = `/api/admin/queues/${queueId}/reset`;

      assert.equal((await request(app).post(path)).status, 401);

      const { token: userToken } = await registerUser(app);
      assert.equal(
        (await request(app).post(path).set("Authorization", `Bearer ${userToken}`)).status,
        403
      );
    });
  });

  describe("POST /api/admin/queues/:queueId/reset", () => {
    it("clears the waiting list (app + walk-in), closes entries, resets counters", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "a@example.com", "Alice");
      const { token: t2 } = await registerUser(app, "b@example.com", "Bob");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Counter Guest" });
      assert.equal(walk.status, 201);

      // Queue in a mid-session state: now serving + paused.
      await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);

      const res = await request(app)
        .post(`/api/admin/queues/${queueId}/reset`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.cleared, 2);
      assert.equal(res.body.queue.id, queueId);
      assert.equal(res.body.queue.status, "open");
      assert.equal(res.body.queue.nowServing, null);
      assert.equal(res.body.queue.name, "Cafeteria");

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 0);

      const dbQueue = await Queue.findById(queueId);
      assert.equal(dbQueue.nextTokenNumber, 1);
    });

    it("closes waiting entries as left so users see history and can rejoin", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app, "rejoin@example.com", "Rejoiner");

      await joinQueue(app, userToken, queueId);

      const reset = await request(app)
        .post(`/api/admin/queues/${queueId}/reset`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(reset.status, 200);
      assert.equal(reset.body.cleared, 1);

      // The user's membership is no longer active; history records the close as left.
      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(status.status, 404);

      const hist = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(hist.status, 200);
      assert.equal(hist.body.events[0].outcome, "left");

      // Fresh session starts tokens back at 1.
      const rejoin = await joinQueue(app, userToken, queueId);
      assert.equal(rejoin.tokenNumber, 1);
      assert.equal(rejoin.position, 1);
    });

    it("resets an already-clean queue idempotently (cleared 0)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const res = await request(app)
        .post(`/api/admin/queues/${queueId}/reset`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.cleared, 0);
      assert.equal(res.body.queue.status, "open");
      assert.equal(res.body.queue.nowServing, null);
    });

    it("returns 404 for unknown queue", async () => {
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const res = await request(app)
        .post("/api/admin/queues/aaaaaaaaaaaaaaaaaaaaaaaa/reset")
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(res.status, 404);
    });
  });
});
