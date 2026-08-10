import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";

async function registerUser(app, email = "joiner@example.com", name = "Joiner") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function seedAndGetCafeteriaId() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria._id.toString();
}

describe("Join queue + live status (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("POST /api/queues/:queueId/join", () => {
    it("allows unauthenticated join as Guest (mints credential)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      const res = await request(app).post(`/api/queues/${queueId}/join`);

      // Guest peer path: first join without JWT mints a device credential.
      assert.equal(res.status, 201);
      assert.equal(typeof res.body.guestCredential, "string");
      assert.equal(res.body.tokenNumber, 1);
    });

    it("rejects join for a non-existent queue", async () => {
      await seedVenueAndQueues();
      const app = testApp();
      const token = await registerUser(app);
      const fakeId = "aaaaaaaaaaaaaaaaaaaaaaaa";

      const res = await request(app)
        .post(`/api/queues/${fakeId}/join`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 404);
    });

    it("joins a queue and returns token, position, ETA, and now serving", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      const res = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 201);
      assert.equal(res.body.tokenNumber, 1);
      assert.equal(res.body.position, 1);
      // Cafeteria averageServiceTime = 3 → ETA = 1 × 3
      assert.equal(res.body.etaMinutes, 3);
      assert.equal(res.body.nowServing, null);
      assert.equal(res.body.averageServiceTime, 3);
      assert.equal(res.body.status, "waiting");
      assert.equal(res.body.queue.id, queueId);
      assert.equal(res.body.queue.name, "Cafeteria");
    });

    it("assigns sequential tokens and positions; ETA uses position × averageServiceTime", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const tokenA = await registerUser(app, "a@example.com", "User A");
      const tokenB = await registerUser(app, "b@example.com", "User B");

      const first = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${tokenA}`);
      const second = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${tokenB}`);

      assert.equal(first.status, 201);
      assert.equal(second.status, 201);

      assert.equal(first.body.tokenNumber, 1);
      assert.equal(first.body.position, 1);
      assert.equal(first.body.etaMinutes, 3); // 1 × 3

      assert.equal(second.body.tokenNumber, 2);
      assert.equal(second.body.position, 2);
      assert.equal(second.body.etaMinutes, 6); // 2 × 3
    });

    it("rejects double-join when user is already waiting in the same queue", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      const first = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(first.status, 201);

      const again = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(again.status, 409);
      assert.ok(typeof again.body.error === "string");
    });

    it("uses Gym averageServiceTime (5) for ETA on that queue", async () => {
      await seedVenueAndQueues();
      const gym = await Queue.findOne({ slug: "gym" });
      const app = testApp();
      const token = await registerUser(app);

      const res = await request(app)
        .post(`/api/queues/${gym._id.toString()}/join`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 201);
      assert.equal(res.body.position, 1);
      assert.equal(res.body.averageServiceTime, 5);
      assert.equal(res.body.etaMinutes, 5); // 1 × 5
    });
  });

  describe("GET /api/queues/:queueId/status", () => {
    it("rejects unauthenticated status", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      const res = await request(app).get(`/api/queues/${queueId}/status`);

      assert.equal(res.status, 401);
    });

    it("returns 404 when user has not joined the queue", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      const res = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 404);
    });

    it("returns live status matching join fields after join", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const tokenA = await registerUser(app, "first@example.com", "First");
      const tokenB = await registerUser(app, "second@example.com", "Second");

      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${tokenA}`);
      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${tokenB}`);

      const res = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${tokenB}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.tokenNumber, 2);
      assert.equal(res.body.position, 2);
      assert.equal(res.body.etaMinutes, 6);
      assert.equal(res.body.nowServing, null);
      assert.equal(res.body.averageServiceTime, 3);
      assert.equal(res.body.status, "waiting");
      assert.equal(res.body.queue.name, "Cafeteria");
    });

    it("reports correct positions for two concurrent waiters", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const tokenA = await registerUser(app, "ahead@example.com", "Ahead");
      const tokenB = await registerUser(app, "behind@example.com", "Behind");

      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${tokenA}`);
      await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${tokenB}`);

      const statusB = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${tokenB}`);

      assert.equal(statusB.status, 200);
      assert.equal(statusB.body.position, 2);
      assert.equal(statusB.body.etaMinutes, 6);

      const statusA = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${tokenA}`);

      assert.equal(statusA.status, 200);
      assert.equal(statusA.body.position, 1);
      assert.equal(statusA.body.etaMinutes, 3);
    });
  });
});
