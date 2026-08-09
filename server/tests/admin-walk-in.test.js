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

/**
 * Stretch: admin walk-in — counter arrivals without prior app join.
 * POST /api/admin/queues/:queueId/walk-in
 * Body: { name, tokenNumber? } — tokenNumber optional (auto next) or manual.
 */
describe("Admin walk-in (HTTP API)", () => {
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
    it("rejects unauthenticated and non-admin walk-in", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const path = `/api/admin/queues/${queueId}/walk-in`;

      assert.equal((await request(app).post(path).send({ name: "Walk-in" })).status, 401);

      const { token: userToken } = await registerUser(app);
      assert.equal(
        (
          await request(app)
            .post(path)
            .set("Authorization", `Bearer ${userToken}`)
            .send({ name: "Walk-in" })
        ).status,
        403
      );
    });
  });

  describe("POST /api/admin/queues/:queueId/walk-in", () => {
    it("creates a walk-in with auto token and lists it for serve", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Counter Guest" });

      assert.equal(walk.status, 201);
      assert.equal(walk.body.entry.tokenNumber, 1);
      assert.equal(walk.body.entry.status, "waiting");
      assert.equal(walk.body.entry.isWalkIn, true);
      assert.equal(walk.body.entry.name, "Counter Guest");
      assert.equal(walk.body.entry.position, 1);
      assert.ok(walk.body.entry.id);
      assert.equal(walk.body.queue.id, queueId);
      assert.equal(walk.body.queue.name, "Cafeteria");

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(list.status, 200);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].tokenNumber, 1);
      assert.equal(list.body.waiting[0].isWalkIn, true);
      assert.equal(list.body.waiting[0].user.name, "Counter Guest");
      assert.equal(list.body.waiting[0].user.email, null);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(serve.status, 200);
      assert.equal(serve.body.served.tokenNumber, 1);
      assert.equal(serve.body.queue.nowServing, 1);

      const empty = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(empty.body.waiting.length, 0);
    });

    it("accepts a manual token number and advances nextTokenNumber past it", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Paper Token", tokenNumber: 42 });

      assert.equal(walk.status, 201);
      assert.equal(walk.body.entry.tokenNumber, 42);
      assert.equal(walk.body.entry.isWalkIn, true);

      // Next auto issue (app join or walk-in) must not reuse 42.
      const { token: userToken } = await registerUser(app, "app@example.com", "App User");
      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 201);
      assert.equal(join.body.tokenNumber, 43);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 2);
      assert.deepEqual(
        list.body.waiting.map((w) => w.tokenNumber).sort((a, b) => a - b),
        [42, 43]
      );
    });

    it("walk-in participates in skip flow with app-joined waiters", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app, "app2@example.com", "App Two");

      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Walk-in B" });
      assert.equal(walk.status, 201);
      assert.equal(walk.body.entry.tokenNumber, 2);

      // Skip next (app user token 1); walk-in remains.
      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(skip.status, 200);
      assert.equal(skip.body.skipped.tokenNumber, 1);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].tokenNumber, 2);
      assert.equal(list.body.waiting[0].isWalkIn, true);
      assert.equal(list.body.waiting[0].user.name, "Walk-in B");

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 200);
      assert.equal(serve.body.served.tokenNumber, 2);
    });

    it("rejects missing name and duplicate active token", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const missing = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      assert.equal(missing.status, 400);

      const blank = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "   " });
      assert.equal(blank.status, 400);

      const first = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "First", tokenNumber: 7 });
      assert.equal(first.status, 201);

      const dup = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Second", tokenNumber: 7 });
      assert.equal(dup.status, 409);

      const badToken = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Bad", tokenNumber: 0 });
      assert.equal(badToken.status, 400);
    });

    it("returns 404 for unknown queue", async () => {
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const res = await request(app)
        .post("/api/admin/queues/aaaaaaaaaaaaaaaaaaaaaaaa/walk-in")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "X" });
      assert.equal(res.status, 404);
    });

    it("allows walk-in while paused (list preserved; serve still blocked)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Paused Walk-in" });
      assert.equal(walk.status, 201);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 409);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.queue.status, "paused");
    });
  });
});
