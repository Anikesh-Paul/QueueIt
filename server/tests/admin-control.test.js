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
  assert.equal(res.body.user.role, "admin");
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

describe("Admin control: waiting list / serve / skip / pause (HTTP API)", () => {
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
    it("rejects unauthenticated access to waiting list, serve, skip, pause, resume", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const base = `/api/admin/queues/${queueId}`;

      assert.equal((await request(app).get(`${base}/waiting-list`)).status, 401);
      assert.equal((await request(app).post(`${base}/serve`)).status, 401);
      assert.equal((await request(app).post(`${base}/skip`)).status, 401);
      assert.equal((await request(app).post(`${base}/pause`)).status, 401);
      assert.equal((await request(app).post(`${base}/resume`)).status, 401);
    });

    it("rejects a valid user token on admin control APIs", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token } = await registerUser(app);
      const base = `/api/admin/queues/${queueId}`;

      assert.equal(
        (await request(app).get(`${base}/waiting-list`).set("Authorization", `Bearer ${token}`))
          .status,
        403
      );
      assert.equal(
        (await request(app).post(`${base}/serve`).set("Authorization", `Bearer ${token}`)).status,
        403
      );
      assert.equal(
        (await request(app).post(`${base}/skip`).set("Authorization", `Bearer ${token}`)).status,
        403
      );
      assert.equal(
        (await request(app).post(`${base}/pause`).set("Authorization", `Bearer ${token}`)).status,
        403
      );
      assert.equal(
        (await request(app).post(`${base}/resume`).set("Authorization", `Bearer ${token}`)).status,
        403
      );
    });
  });

  describe("GET /api/admin/queues/:queueId/waiting-list", () => {
    it("returns empty waiting list and queue meta for an open queue", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token } = await createAdmin(app);

      const res = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.queue.id, queueId);
      assert.equal(res.body.queue.name, "Cafeteria");
      assert.equal(res.body.queue.status, "open");
      assert.equal(res.body.queue.nowServing, null);
      assert.equal(res.body.queue.averageServiceTime, 3);
      assert.deepEqual(res.body.waiting, []);
    });

    it("lists waiters in token order with positions and user fields", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "a@example.com", "Alice");
      const { token: t2 } = await registerUser(app, "b@example.com", "Bob");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const res = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.waiting.length, 2);
      assert.equal(res.body.waiting[0].tokenNumber, 1);
      assert.equal(res.body.waiting[0].position, 1);
      assert.equal(res.body.waiting[0].user.name, "Alice");
      assert.equal(res.body.waiting[0].user.email, "a@example.com");
      assert.ok(typeof res.body.waiting[0].id === "string");
      assert.ok(typeof res.body.waiting[0].joinedAt === "string");
      assert.equal(res.body.waiting[1].tokenNumber, 2);
      assert.equal(res.body.waiting[1].position, 2);
      assert.equal(res.body.waiting[1].user.name, "Bob");
    });

    it("returns 404 for unknown queue", async () => {
      await seedVenueAndQueues();
      const app = testApp();
      const { token } = await createAdmin(app);
      const fakeId = "aaaaaaaaaaaaaaaaaaaaaaaa";

      const res = await request(app)
        .get(`/api/admin/queues/${fakeId}/waiting-list`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 404);
    });
  });

  describe("POST /api/admin/queues/:queueId/serve", () => {
    it("serves the next waiter: marks served, sets nowServing, advances positions", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "first@example.com", "First");
      const { token: t2 } = await registerUser(app, "second@example.com", "Second");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(serve.status, 200);
      assert.equal(serve.body.served.tokenNumber, 1);
      assert.equal(serve.body.served.status, "served");
      assert.equal(serve.body.queue.nowServing, 1);
      assert.equal(serve.body.queue.status, "open");

      // Served user no longer has active membership.
      const status1 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(status1.status, 404);

      // Remaining waiter moves to front; now serving reflects admin action.
      const status2 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t2}`);
      assert.equal(status2.status, 200);
      assert.equal(status2.body.tokenNumber, 2);
      assert.equal(status2.body.position, 1);
      assert.equal(status2.body.etaMinutes, 3);
      assert.equal(status2.body.nowServing, 1);

      // History records served for the first user.
      const hist = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(hist.status, 200);
      assert.equal(hist.body.events[0].outcome, "served");
      assert.equal(hist.body.events[0].tokenNumber, 1);

      // Waiting list no longer includes served entry.
      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].tokenNumber, 2);
      assert.equal(list.body.queue.nowServing, 1);
    });

    it("serves a selected waiting entry by entryId when provided", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "a@example.com", "A");
      const { token: t2 } = await registerUser(app, "b@example.com", "B");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      const secondId = list.body.waiting[1].id;

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ entryId: secondId });

      assert.equal(serve.status, 200);
      assert.equal(serve.body.served.tokenNumber, 2);
      assert.equal(serve.body.queue.nowServing, 2);

      // First waiter remains waiting at position 1.
      const status1 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(status1.status, 200);
      assert.equal(status1.body.position, 1);
      assert.equal(status1.body.nowServing, 2);
    });

    it("returns 404 when there is no one waiting to serve", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(serve.status, 404);
      assert.ok(typeof serve.body.error === "string");
    });

    it("rejects serve while the queue is paused", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await joinQueue(app, userToken, queueId);

      const pause = await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(pause.status, 200);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(serve.status, 409);
      assert.ok(/pause/i.test(serve.body.error));

      // Waiter still active; positions frozen (still waiting).
      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.status, "waiting");
      assert.equal(status.body.queue.status, "paused");
    });
  });

  describe("POST /api/admin/queues/:queueId/skip", () => {
    it("skips the next waiter without permanently blocking the line", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "skipme@example.com", "Skip Me");
      const { token: t2 } = await registerUser(app, "next@example.com", "Next Up");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(skip.status, 200);
      assert.equal(skip.body.skipped.tokenNumber, 1);
      assert.equal(skip.body.skipped.status, "skipped");
      // Skip advances now serving so the line does not stall on the skipped token.
      assert.equal(skip.body.queue.nowServing, 1);

      const status1 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(status1.status, 404);

      const status2 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t2}`);
      assert.equal(status2.status, 200);
      assert.equal(status2.body.position, 1);
      assert.equal(status2.body.nowServing, 1);

      const hist = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(hist.body.events[0].outcome, "skipped");

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].tokenNumber, 2);
    });

    it("skips a selected entry by entryId", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "a@example.com", "A");
      const { token: t2 } = await registerUser(app, "b@example.com", "B");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      const secondId = list.body.waiting[1].id;

      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ entryId: secondId });

      assert.equal(skip.status, 200);
      assert.equal(skip.body.skipped.tokenNumber, 2);
      assert.equal(skip.body.queue.nowServing, 2);

      const status1 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(status1.status, 200);
      assert.equal(status1.body.position, 1);
    });

    it("rejects skip while the queue is paused", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);
      await joinQueue(app, userToken, queueId);

      await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);

      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(skip.status, 409);
    });
  });

  describe("POST pause / resume", () => {
    it("pauses a queue, preserves waiters, and resumes service", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await joinQueue(app, userToken, queueId);

      const pause = await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(pause.status, 200);
      assert.equal(pause.body.queue.status, "paused");
      assert.equal(pause.body.queue.id, queueId);

      // Waiters preserved.
      const listPaused = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(listPaused.body.queue.status, "paused");
      assert.equal(listPaused.body.waiting.length, 1);

      const userStatus = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(userStatus.status, 200);
      assert.equal(userStatus.body.queue.status, "paused");
      assert.equal(userStatus.body.position, 1);

      const resume = await request(app)
        .post(`/api/admin/queues/${queueId}/resume`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(resume.status, 200);
      assert.equal(resume.body.queue.status, "open");

      // After resume, serve works again.
      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 200);
      assert.equal(serve.body.served.tokenNumber, 1);
      assert.equal(serve.body.queue.nowServing, 1);
    });

    it("pause is idempotent when already paused; resume when open is ok", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const pause1 = await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);
      const pause2 = await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(pause1.status, 200);
      assert.equal(pause2.status, 200);
      assert.equal(pause2.body.queue.status, "paused");

      const resume1 = await request(app)
        .post(`/api/admin/queues/${queueId}/resume`)
        .set("Authorization", `Bearer ${adminToken}`);
      const resume2 = await request(app)
        .post(`/api/admin/queues/${queueId}/resume`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(resume1.status, 200);
      assert.equal(resume2.status, 200);
      assert.equal(resume2.body.queue.status, "open");
    });
  });
});
