import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";

describe("API hardening (Helmet, JSON cap, rate limits)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("sends security headers on API responses", async () => {
    const app = testApp();
    const res = await request(app).get("/api/health");

    assert.equal(res.status, 200);
    assert.ok(res.headers["x-content-type-options"]);
    assert.equal(res.headers["x-content-type-options"].toLowerCase(), "nosniff");
    // Helmet hides the default Express fingerprint
    assert.equal(res.headers["x-powered-by"], undefined);
    // cross-origin so the separately hosted frontend can read API responses
    assert.equal(res.headers["cross-origin-resource-policy"], "cross-origin");
  });

  it("rejects JSON bodies larger than the 16kb cap with 413", async () => {
    const app = testApp();
    const oversized = "x".repeat(17 * 1024);
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send({ email: "big@example.com", password: oversized });

    assert.equal(res.status, 413);
    assert.match(String(res.body.error || ""), /too large/i);
  });

  it("rate-limits login after the configured number of attempts", async () => {
    const app = testApp({ authRateLimit: { windowMs: 60_000, max: 3 } });

    const attempts = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post("/api/auth/login").send({
        email: "rate@example.com",
        password: "password123",
      });
      attempts.push(res.status);
    }
    assert.ok(
      attempts.every((status) => status === 401 || status === 400),
      `expected 3 allowed attempts, got ${attempts.join(",")}`
    );

    const blocked = await request(app).post("/api/auth/login").send({
      email: "rate@example.com",
      password: "password123",
    });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /too many attempts/i);
  });

  it("rate-limits queue join after the configured number of attempts", async () => {
    await seedVenueAndQueues();
    const app = testApp({ joinRateLimit: { windowMs: 60_000, max: 3 } });

    const list = await request(app).get("/api/queues");
    assert.equal(list.status, 200);
    const queueId = list.body.queues[0].id;

    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("X-Guest-Credential", `guest-limit-${i}`)
        .send({ name: `Guest ${i}` });
      statuses.push(res.status);
    }
    assert.ok(
      statuses.every((status) => status === 201),
      `expected 3 successful joins, got ${statuses.join(",")}`
    );

    const blocked = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("X-Guest-Credential", "guest-limit-blocked")
      .send({ name: "Blocked Guest" });
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /too many attempts/i);
  });

  it("does not rate-limit by default in testApp()", async () => {
    const app = testApp();
    const statuses = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).post("/api/auth/login").send({
        email: "open@example.com",
        password: "password123",
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.every((status) => status !== 429), `got ${statuses.join(",")}`);
  });
});
