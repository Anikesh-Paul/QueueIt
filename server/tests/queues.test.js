import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedDemoAccounts, seedVenueAndQueues } from "../src/seed.js";
import { Venue } from "../src/models/Venue.js";
import { Queue } from "../src/models/Queue.js";

function setSeedEnv() {
  process.env.SEED_ADMIN_EMAIL = "admin@queueit.local";
  process.env.SEED_ADMIN_PASSWORD = "admin-demo-pass";
  process.env.SEED_USER_EMAIL = "user@queueit.local";
  process.env.SEED_USER_PASSWORD = "user-demo-pass";
}

async function registerUser(app, email = "queue-viewer@example.com") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name: "Queue Viewer",
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

describe("Venue seed + list queues (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("seedVenueAndQueues", () => {
    it("upserts Campus Hub with Cafeteria and Gym (deterministic demo catalog)", async () => {
      const result = await seedVenueAndQueues();

      assert.ok(result.venue);
      assert.equal(result.venue.name, "Campus Hub");
      assert.ok(Array.isArray(result.queues));
      assert.ok(result.queues.length >= 1);
      assert.ok(result.queues.length <= 2);

      const venues = await Venue.find();
      const queues = await Queue.find().sort({ name: 1 });

      assert.equal(venues.length, 1);
      assert.equal(venues[0].name, "Campus Hub");
      assert.equal(queues.length, result.queues.length);
      assert.equal(queues.length, 2);
      assert.equal(queues[0].name, "Cafeteria");
      assert.equal(queues[1].name, "Gym");
      assert.equal(queues[0].venue.toString(), venues[0]._id.toString());
      assert.equal(queues[1].venue.toString(), venues[0]._id.toString());
      assert.equal(queues[0].averageServiceTime, 3);
      assert.equal(queues[1].averageServiceTime, 5);
      assert.equal(queues[0].status, "open");
      assert.equal(queues[1].status, "open");
    });

    it("is idempotent on repeated seed runs", async () => {
      await seedVenueAndQueues();
      await seedVenueAndQueues();

      const venues = await Venue.find();
      const queues = await Queue.find();

      assert.equal(venues.length, 1);
      assert.equal(queues.length, 2);
    });
  });

  describe("GET /api/queues", () => {
    it("allows public catalog browse without auth (Guest path)", async () => {
      await seedVenueAndQueues();
      const app = testApp();
      const res = await request(app).get("/api/queues");

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.queues));
      assert.equal(res.body.queues.length, 2);
    });

    it("returns seeded queues for an authenticated user", async () => {
      await seedVenueAndQueues();
      const app = testApp();
      const token = await registerUser(app);

      const res = await request(app)
        .get("/api/queues")
        .set("Authorization", `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.queues));
      assert.equal(res.body.queues.length, 2);

      const names = res.body.queues.map((q) => q.name).sort();
      assert.deepEqual(names, ["Cafeteria", "Gym"]);

      for (const queue of res.body.queues) {
        assert.ok(queue.id);
        assert.ok(queue.name);
        assert.equal(typeof queue.averageServiceTime, "number");
        assert.equal(queue.status, "open");
        assert.ok(queue.venue);
        assert.ok(queue.venue.id);
        assert.equal(queue.venue.name, "Campus Hub");
      }
    });

    it("returns the same catalog for a seeded admin session", async () => {
      setSeedEnv();
      await seedDemoAccounts();
      await seedVenueAndQueues();

      const app = testApp();
      const login = await request(app).post("/api/auth/login").send({
        email: "admin@queueit.local",
        password: "admin-demo-pass",
      });
      assert.equal(login.status, 200);

      const res = await request(app)
        .get("/api/queues")
        .set("Authorization", `Bearer ${login.body.token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.queues.length, 2);
    });
  });
});
