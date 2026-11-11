import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock } from "../src/services/clock.js";
import { computeDynamicNoShowMinutes, resolveNoShowWindow } from "../src/services/noShowWindow.js";

async function createAdmin(app) {
  const password = "password123";
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword(password),
    role: "admin",
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function registerUser(app, email) {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name: email.split("@")[0],
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function joinAs(app, queueId, email) {
  const token = await registerUser(app, email);
  const res = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 201);
  return { token, join: res.body };
}

async function seedCafeteria() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria;
}

describe("computeDynamicNoShowMinutes", () => {
  it("uses the median of arrival samples when there are enough of them", () => {
    const result = computeDynamicNoShowMinutes({
      arrivalMinutes: [1, 1, 2, 2, 2],
      waitingCount: 0,
      paceMinutes: 3,
      fallbackMinutes: 5,
      min: 2,
      max: 15,
    });
    assert.equal(result.source, "arrivals");
    assert.equal(result.minutes, 2);
  });

  it("blends a thin sample with the fallback", () => {
    const result = computeDynamicNoShowMinutes({
      arrivalMinutes: [10],
      waitingCount: 0,
      paceMinutes: 3,
      fallbackMinutes: 5,
      min: 2,
      max: 15,
    });
    assert.equal(result.source, "mixed");
    assert.equal(result.minutes, 7);
  });

  it("falls back and adds length and pace boosts, then clamps", () => {
    const result = computeDynamicNoShowMinutes({
      arrivalMinutes: [],
      waitingCount: 40,
      paceMinutes: 11,
      fallbackMinutes: 5,
      min: 2,
      max: 8,
    });
    assert.equal(result.source, "fallback");
    assert.equal(result.lengthBoost, 4);
    assert.equal(result.paceBoost, 3);
    assert.equal(result.minutes, 8);
  });

  it("adds modest boosts to a typical arrival median", () => {
    const result = computeDynamicNoShowMinutes({
      arrivalMinutes: [8, 9, 10],
      waitingCount: 20,
      paceMinutes: 10,
      fallbackMinutes: 5,
      min: 2,
      max: 15,
    });
    assert.equal(result.source, "arrivals");
    assert.equal(result.lengthBoost, 2);
    assert.equal(result.paceBoost, 2.5);
    assert.equal(result.minutes, 14);
  });
});

describe("Dynamic no-show window", () => {
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

  it("keeps a fixed window even when the line is long and arrivals were slow", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const cafeteria = await seedCafeteria();
    cafeteria.noShowMinutes = 4;
    cafeteria.noShowMode = "fixed";
    cafeteria.noShowMinMinutes = 2;
    cafeteria.noShowMaxMinutes = 15;
    cafeteria.averageServiceTime = 12;
    await cafeteria.save();

    await QueueEntry.create({
      queue: cafeteria._id,
      isWalkIn: true,
      walkInName: "Past A",
      tokenNumber: 90,
      status: "served",
      calledAt: new Date("2026-11-11T04:40:00.000Z"),
      arrivedAt: new Date("2026-11-11T04:50:00.000Z"),
    });

    const window = await resolveNoShowWindow(cafeteria, { waitingCount: 30 });
    assert.equal(window.mode, "fixed");
    assert.equal(window.minutes, 4);
    assert.equal(window.source, "fixed");
  });

  it("computes a dynamic window from recent arrivals and clamps to admin min/max", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const cafeteria = await seedCafeteria();
    cafeteria.noShowMinutes = 5;
    cafeteria.noShowMode = "dynamic";
    cafeteria.noShowMinMinutes = 6;
    cafeteria.noShowMaxMinutes = 8;
    cafeteria.averageServiceTime = 3;
    await cafeteria.save();

    const arrivals = [1, 1, 2, 2, 2];
    for (const [index, minutes] of arrivals.entries()) {
      await QueueEntry.create({
        queue: cafeteria._id,
        isWalkIn: true,
        walkInName: `Past ${index}`,
        tokenNumber: 80 + index,
        status: "served",
        calledAt: new Date("2026-11-11T04:30:00.000Z"),
        arrivedAt: new Date(Date.parse("2026-11-11T04:30:00.000Z") + minutes * 60_000),
      });
    }

    const window = await resolveNoShowWindow(cafeteria, { waitingCount: 0 });
    assert.equal(window.mode, "dynamic");
    assert.equal(window.source, "arrivals");
    // Unclamped would be 2; min is 6.
    assert.equal(window.minutes, 6);
  });

  it("lets an admin switch mode and edit min/max, and rejects a min above max", async () => {
    const cafeteria = await seedCafeteria();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);

    const patched = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({
        noShowMinutes: 5,
        noShowMode: "dynamic",
        noShowMinMinutes: 3,
        noShowMaxMinutes: 12,
      });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.queue.noShowMode, "dynamic");
    assert.equal(patched.body.queue.noShowMinMinutes, 3);
    assert.equal(patched.body.queue.noShowMaxMinutes, 12);

    const bad = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ noShowMinMinutes: 20, noShowMaxMinutes: 8 });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /minimum cannot be greater/i);

    const modeBad = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ noShowMode: "random" });
    assert.equal(modeBad.status, 400);
  });

  it("applies the computed window on call and shows it to staff", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const cafeteria = await seedCafeteria();
    cafeteria.noShowMinutes = 5;
    cafeteria.noShowMode = "dynamic";
    cafeteria.noShowMinMinutes = 2;
    cafeteria.noShowMaxMinutes = 15;
    cafeteria.averageServiceTime = 3;
    await cafeteria.save();
    const queueId = cafeteria._id.toString();

    for (const [index, minutes] of [3, 3, 3].entries()) {
      await QueueEntry.create({
        queue: cafeteria._id,
        isWalkIn: true,
        walkInName: `Past ${index}`,
        tokenNumber: 70 + index,
        status: "served",
        calledAt: new Date("2026-11-11T04:20:00.000Z"),
        arrivedAt: new Date(Date.parse("2026-11-11T04:20:00.000Z") + minutes * 60_000),
      });
    }

    const app = testApp();
    const admin = await createAdmin(app);
    await joinAs(app, queueId, "dynamic-call@example.com");

    const call = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);
    assert.equal(call.body.called.noShowWindowMinutes, 3);
    assert.equal(call.body.called.noShowWindowMode, "dynamic");
    const deadline = new Date(call.body.called.servingDeadlineAt).getTime();
    assert.equal(deadline - Date.parse("2026-11-11T05:00:00.000Z"), 3 * 60 * 1000);

    const list = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.queue.noShowMode, "dynamic");
    assert.equal(list.body.queue.noShowWindow.mode, "dynamic");
    assert.equal(list.body.queue.noShowWindow.minutes, 3);
    assert.equal(list.body.waiting[0].noShowWindowMinutes, 3);
    assert.equal(list.body.waiting[0].noShowWindowMode, "dynamic");
  });
});
