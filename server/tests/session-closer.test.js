import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock, advanceMs } from "../src/services/clock.js";
import { closeExpiredSessions } from "../src/services/sessionCloser.js";

const LUNCH_MID = "2026-08-10T12:00:00+05:30";
const LUNCH_END = "2026-08-10T14:30:00+05:30";

async function createAdmin(app) {
  const password = "password123";
  const passwordHash = await User.hashPassword(password);
  await User.create({
    email: "closer-admin@example.com",
    name: "Admin",
    passwordHash,
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({
    email: "closer-admin@example.com",
    password,
  });
  assert.equal(res.status, 200);
  return res.body.token;
}

describe("Punctual session closer (long-running tick)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
    resetClock();
  });

  beforeEach(async () => {
    await resetDb();
    resetClock();
  });

  it("closes an expired accepting queue with no HTTP traffic after session end", async () => {
    setNow(LUNCH_MID);
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const app = testApp();
    const adminToken = await createAdmin(app);

    await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/stop-accepting`)
      .set("Authorization", `Bearer ${adminToken}`);
    const start = await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/start-accepting`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(start.status, 200);
    assert.equal(start.body.queue.acceptingTokens, true);
    assert.ok(start.body.queue.sessionEndsAt);

    // Cross the bound end without any further HTTP on this queue.
    setNow(LUNCH_END);
    advanceMs(1);

    const closed = await closeExpiredSessions();
    assert.equal(closed, 1);

    const reloaded = await Queue.findById(cafeteria._id);
    assert.equal(reloaded.acceptingTokens, false);
    assert.equal(reloaded.sessionEndsAt, null);
  });

  it("is a no-op when the session has not ended yet", async () => {
    setNow(LUNCH_MID);
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const app = testApp();
    const adminToken = await createAdmin(app);

    await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/stop-accepting`)
      .set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/start-accepting`)
      .set("Authorization", `Bearer ${adminToken}`);

    const closed = await closeExpiredSessions();
    assert.equal(closed, 0);
    const reloaded = await Queue.findById(cafeteria._id);
    assert.equal(reloaded.acceptingTokens, true);
  });
});
