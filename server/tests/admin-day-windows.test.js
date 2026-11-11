import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock } from "../src/services/clock.js";

async function createAdmin(app) {
  const password = "password123";
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword(password),
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({
    email: "admin@example.com",
    password,
  });
  assert.equal(res.status, 200);
  return res.body.token;
}

describe("Admin day-of-week service windows (HTTP)", () => {
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

  it("saves weekday vs weekend windows and binds start/reopen across the weekend", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);

    const saved = await request(app)
      .put(`/api/admin/queues/${queueId}/service-windows`)
      .set("Authorization", `Bearer ${admin}`)
      .send({
        serviceWindows: [
          { start: "11:30", end: "14:30", days: "weekdays" },
          { start: "10:00", end: "13:00", days: "weekend" },
        ],
      });
    assert.equal(saved.status, 200);
    const windows = saved.body.queue.serviceWindows;
    assert.equal(windows.length, 2);
    assert.deepEqual(windows.find((w) => w.start === "11:30").days, [1, 2, 3, 4, 5]);
    assert.deepEqual(windows.find((w) => w.start === "10:00").days, [0, 6]);

    // Friday 14:00 IST — weekday lunch still open, but after it ends reopen should be Saturday 10:00.
    setNow("2026-08-14T14:00:00+05:30");
    const stop = await request(app)
      .post(`/api/admin/queues/${queueId}/stop-accepting`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});
    assert.equal(stop.status, 200);
    assert.equal(
      new Date(stop.body.queue.reopenAt).toISOString(),
      new Date("2026-08-15T10:00:00+05:30").toISOString()
    );

    setNow("2026-08-15T09:30:00+05:30");
    const start = await request(app)
      .post(`/api/admin/queues/${queueId}/start-accepting`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});
    assert.equal(start.status, 200);
    assert.equal(
      new Date(start.body.queue.sessionEndsAt).toISOString(),
      new Date("2026-08-15T13:00:00+05:30").toISOString()
    );
  });
});
