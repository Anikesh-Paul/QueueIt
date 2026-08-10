import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock, advanceMs } from "../src/services/clock.js";
import { attachRealtime } from "../src/services/realtime.js";

/**
 * Ticket 02 — service windows, target bind, auto-close, extend, reopen.
 * Seam: Queue HTTP (join, catalog, status, admin control) + controllable clock.
 */

/** Fixed campus instants (ISO with +05:30 = Asia/Kolkata wall). */
const IST = {
  /** Monday lunch mid-window 12:00 IST */
  lunchMid: "2026-08-10T12:00:00+05:30",
  /** Before lunch 10:00 IST */
  beforeLunch: "2026-08-10T10:00:00+05:30",
  /** Between lunch and dinner 15:00 IST */
  between: "2026-08-10T15:00:00+05:30",
  /** Lunch end exactly 14:30 IST */
  lunchEnd: "2026-08-10T14:30:00+05:30",
  /** After all windows 22:00 IST */
  afterDinner: "2026-08-10T22:00:00+05:30",
  /** Dinner mid 20:00 IST */
  dinnerMid: "2026-08-10T20:00:00+05:30",
};

async function registerUser(app, email = "waiter@example.com", name = "Waiter") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return { token: res.body.token, user: res.body.user };
}

async function createAdmin(app, email = "admin@example.com") {
  const password = "password123";
  const passwordHash = await User.hashPassword(password);
  await User.create({
    email,
    name: "Admin",
    passwordHash,
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return { token: res.body.token, user: res.body.user };
}

async function seedQueues() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  const gym = await Queue.findOne({ slug: "gym" });
  assert.ok(cafeteria);
  assert.ok(gym);
  return {
    cafeteriaId: cafeteria._id.toString(),
    gymId: gym._id.toString(),
    cafeteria,
    gym,
  };
}

describe("Service windows + auto-close + extend (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
    resetClock();
    attachRealtime(null);
  });

  describe("seed + catalog schedule honesty", () => {
    it("seed installs Cafeteria and Gym default windows (IST) and catalog returns them", async () => {
      const { cafeteriaId, gymId } = await seedQueues();
      const app = testApp();

      const res = await request(app).get("/api/queues");
      assert.equal(res.status, 200);

      const cafeteria = res.body.queues.find((q) => q.id === cafeteriaId);
      const gym = res.body.queues.find((q) => q.id === gymId);
      assert.ok(cafeteria);
      assert.ok(gym);

      assert.deepEqual(cafeteria.serviceWindows, [
        { start: "11:30", end: "14:30" },
        { start: "19:00", end: "21:00" },
      ]);
      assert.deepEqual(gym.serviceWindows, [{ start: "17:00", end: "21:00" }]);
    });
  });

  describe("start accepting binds target window", () => {
    it("inside lunch binds session end to lunch end (14:30 IST same day)", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      // Ensure closed first so start is intentional.
      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const start = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(start.status, 200);
      assert.equal(start.body.queue.acceptingTokens, true);
      assert.equal(
        new Date(start.body.queue.sessionEndsAt).toISOString(),
        new Date(IST.lunchEnd).toISOString()
      );
      assert.equal(start.body.queue.reopenAt, null);
    });

    it("early (before first window) binds to next upcoming window end", async () => {
      setNow(IST.beforeLunch);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const start = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(start.status, 200);
      assert.equal(
        new Date(start.body.queue.sessionEndsAt).toISOString(),
        new Date(IST.lunchEnd).toISOString()
      );
    });

    it("between windows binds to next (dinner) window end", async () => {
      setNow(IST.between);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const start = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(start.status, 200);
      assert.equal(
        new Date(start.body.queue.sessionEndsAt).toISOString(),
        new Date("2026-08-10T21:00:00+05:30").toISOString()
      );
    });

    it("window start does not auto-start accepting tokens", async () => {
      setNow(IST.beforeLunch);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      // Advance past lunch open (11:30) without Admin start.
      setNow("2026-08-10T11:45:00+05:30");

      const catalog = await request(app).get("/api/queues");
      const cafeteria = catalog.body.queues.find((q) => q.id === cafeteriaId);
      assert.equal(cafeteria.acceptingTokens, false);

      const { token: userToken } = await registerUser(app);
      const join = await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 409);
    });
  });

  describe("auto-close at session end", () => {
    it("closes at bound end: join blocked, waiting preserved (drain)", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const joined = await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(joined.status, 201);
      const tokenNumber = joined.body.tokenNumber;

      // Cross session end.
      setNow(IST.lunchEnd);
      advanceMs(1);

      const { token: lateToken } = await registerUser(app, "late@example.com");
      const join2 = await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${lateToken}`);
      assert.equal(join2.status, 409);

      const list = await request(app)
        .get(`/api/admin/queues/${cafeteriaId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.status, 200);
      assert.equal(list.body.queue.acceptingTokens, false);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].tokenNumber, tokenNumber);

      // Drain: serve still works.
      const serve = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 200);
    });
  });

  describe("extend session end", () => {
    it("extend +15 keeps join allowed until the new end", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      const start = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      const originalEnd = new Date(start.body.queue.sessionEndsAt);

      const extend = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/extend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ minutes: 15 });
      assert.equal(extend.status, 200);
      assert.equal(extend.body.queue.acceptingTokens, true);
      assert.equal(
        new Date(extend.body.queue.sessionEndsAt).getTime(),
        originalEnd.getTime() + 15 * 60 * 1000
      );

      // At original end, still accepting.
      setNow(IST.lunchEnd);
      advanceMs(1);
      const { token: userToken } = await registerUser(app);
      const join = await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 201);

      // After +15, auto-close.
      setNow(new Date(originalEnd.getTime() + 15 * 60 * 1000 + 1));
      const joinLate = await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${(await registerUser(app, "late2@example.com")).token}`);
      assert.equal(joinLate.status, 409);
    });

    it("extend +30 and explicit endsAt move session end", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      const start = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      const originalEnd = new Date(start.body.queue.sessionEndsAt);

      const plus30 = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/extend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ minutes: 30 });
      assert.equal(plus30.status, 200);
      assert.equal(
        new Date(plus30.body.queue.sessionEndsAt).getTime(),
        originalEnd.getTime() + 30 * 60 * 1000
      );

      const explicit = new Date(originalEnd.getTime() + 45 * 60 * 1000).toISOString();
      const byTime = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/extend`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ endsAt: explicit });
      assert.equal(byTime.status, 200);
      assert.equal(
        new Date(byTime.body.queue.sessionEndsAt).toISOString(),
        new Date(explicit).toISOString()
      );
    });
  });

  describe("stop accepting + reopen", () => {
    it("early stop defaults reopen to next scheduled window start", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const stop = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(stop.status, 200);
      assert.equal(stop.body.queue.acceptingTokens, false);
      // Next window after 12:00 is dinner 19:00 same day.
      assert.equal(
        new Date(stop.body.queue.reopenAt).toISOString(),
        new Date("2026-08-10T19:00:00+05:30").toISOString()
      );
      assert.equal(stop.body.queue.sessionEndsAt, null);

      const catalog = await request(app).get("/api/queues");
      const cafeteria = catalog.body.queues.find((q) => q.id === cafeteriaId);
      assert.equal(
        new Date(cafeteria.reopenAt).toISOString(),
        new Date("2026-08-10T19:00:00+05:30").toISOString()
      );
    });

    it("admin can override reopen time on early stop", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const override = "2026-08-10T16:00:00+05:30";
      const stop = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reopenAt: override });
      assert.equal(stop.status, 200);
      assert.equal(
        new Date(stop.body.queue.reopenAt).toISOString(),
        new Date(override).toISOString()
      );
    });
  });

  describe("closed + empty auto-prepare", () => {
    it("auto-prepares token numbering when Closed and waiting list empty", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);

      // nextTokenNumber should be 2 after one join.
      let dbQueue = await Queue.findById(cafeteriaId);
      assert.equal(dbQueue.nextTokenNumber, 2);

      const stop = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(stop.status, 200);
      assert.equal(stop.body.queue.acceptingTokens, false);

      dbQueue = await Queue.findById(cafeteriaId);
      assert.equal(dbQueue.acceptingTokens, false);
      assert.equal(dbQueue.nextTokenNumber, 1);
      assert.equal(dbQueue.nowServing, null);
    });
  });

  describe("guest parity", () => {
    it("guest join blocked after auto-close like user join", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      setNow(IST.lunchEnd);
      advanceMs(1);

      const join = await request(app).post(`/api/queues/${cafeteriaId}/join`);
      assert.equal(join.status, 409);
      assert.match(join.body.error || "", /closed|not accepting/i);
    });
  });
});
