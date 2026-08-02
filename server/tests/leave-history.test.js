import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";

async function registerUser(app, email = "leaver@example.com", name = "Leaver") {
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

async function joinQueue(app, token, queueId) {
  const res = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 201);
  return res.body;
}

describe("Leave queue + user history (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("POST /api/queues/:queueId/leave", () => {
    it("rejects unauthenticated leave", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      const res = await request(app).post(`/api/queues/${queueId}/leave`);

      assert.equal(res.status, 401);
    });

    it("returns 404 when user is not in the queue", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      const res = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 404);
      assert.ok(typeof res.body.error === "string");
    });

    it("leaves an active queue and frees the slot", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      await joinQueue(app, token, queueId);

      const leave = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);

      assert.equal(leave.status, 200);
      assert.equal(leave.body.status, "left");
      assert.equal(leave.body.tokenNumber, 1);
      assert.equal(leave.body.queue.id, queueId);
      assert.equal(leave.body.queue.name, "Cafeteria");

      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(status.status, 404);

      // Entry is terminal "left", not still active.
      const entry = await QueueEntry.findOne({ tokenNumber: 1 });
      assert.ok(entry);
      assert.equal(entry.status, "left");
    });

    it("advances positions for remaining waiters after someone leaves", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const tokenA = await registerUser(app, "ahead@example.com", "Ahead");
      const tokenB = await registerUser(app, "behind@example.com", "Behind");

      await joinQueue(app, tokenA, queueId);
      await joinQueue(app, tokenB, queueId);

      const leaveA = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${tokenA}`);
      assert.equal(leaveA.status, 200);

      const statusB = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${tokenB}`);

      assert.equal(statusB.status, 200);
      assert.equal(statusB.body.tokenNumber, 2);
      assert.equal(statusB.body.position, 1);
      assert.equal(statusB.body.etaMinutes, 3); // 1 × 3
    });

    it("allows re-join after leave with a new token", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      await joinQueue(app, token, queueId);
      const leave = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(leave.status, 200);

      const again = await joinQueue(app, token, queueId);
      assert.equal(again.tokenNumber, 2);
      assert.equal(again.position, 1);
      assert.equal(again.status, "waiting");
    });

    it("rejects leave when already left (not active)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      await joinQueue(app, token, queueId);
      const first = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(first.status, 200);

      const second = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(second.status, 404);
    });
  });

  describe("GET /api/queues/history", () => {
    it("rejects unauthenticated history", async () => {
      await seedVenueAndQueues();
      const app = testApp();

      const res = await request(app).get("/api/queues/history");

      assert.equal(res.status, 401);
    });

    it("returns empty history for a user with no queue events", async () => {
      await seedVenueAndQueues();
      const app = testApp();
      const token = await registerUser(app);

      const res = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.deepEqual(res.body.events, []);
    });

    it("records joined when the user joins a queue", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      await joinQueue(app, token, queueId);

      const res = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.events.length, 1);
      const event = res.body.events[0];
      assert.equal(event.outcome, "joined");
      assert.equal(event.status, "waiting");
      assert.equal(event.tokenNumber, 1);
      assert.equal(event.queue.id, queueId);
      assert.equal(event.queue.name, "Cafeteria");
      assert.ok(typeof event.id === "string");
      assert.ok(typeof event.joinedAt === "string");
      assert.ok(typeof event.updatedAt === "string");
    });

    it("records left after the user leaves", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app);

      await joinQueue(app, token, queueId);
      await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);

      const res = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.events.length, 1);
      assert.equal(res.body.events[0].outcome, "left");
      assert.equal(res.body.events[0].status, "left");
      assert.equal(res.body.events[0].tokenNumber, 1);
    });

    it("lists served and skipped outcomes when those terminal states exist", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const token = await registerUser(app, "history@example.com", "History User");

      // Join twice with leave in between so we have two entries to terminate.
      await joinQueue(app, token, queueId);
      await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${token}`);
      await joinQueue(app, token, queueId);

      // Simulate admin transitions (ticket 07) by setting terminal statuses.
      const entries = await QueueEntry.find({}).sort({ tokenNumber: 1 });
      assert.equal(entries.length, 2);
      entries[0].status = "served";
      await entries[0].save();
      entries[1].status = "skipped";
      await entries[1].save();

      const res = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.events.length, 2);
      const outcomes = res.body.events.map((e) => e.outcome).sort();
      assert.deepEqual(outcomes, ["served", "skipped"].sort());
      for (const event of res.body.events) {
        assert.ok(["served", "skipped"].includes(event.outcome));
        assert.equal(event.outcome, event.status);
        assert.equal(event.queue.name, "Cafeteria");
      }
    });

    it("returns only the authenticated user's events, newest first", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const tokenA = await registerUser(app, "a@example.com", "User A");
      const tokenB = await registerUser(app, "b@example.com", "User B");

      await joinQueue(app, tokenA, queueId);
      await joinQueue(app, tokenB, queueId);
      await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set("Authorization", `Bearer ${tokenA}`);
      await joinQueue(app, tokenA, queueId);

      const resA = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${tokenA}`);
      const resB = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${tokenB}`);

      assert.equal(resA.status, 200);
      assert.equal(resB.status, 200);
      assert.equal(resA.body.events.length, 2);
      assert.equal(resB.body.events.length, 1);
      // Newest first: active join (token 3) then left (token 1)
      assert.equal(resA.body.events[0].tokenNumber, 3);
      assert.equal(resA.body.events[0].outcome, "joined");
      assert.equal(resA.body.events[1].tokenNumber, 1);
      assert.equal(resA.body.events[1].outcome, "left");
      assert.equal(resB.body.events[0].tokenNumber, 2);
      assert.equal(resB.body.events[0].outcome, "joined");
    });
  });
});
