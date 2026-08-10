import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { attachRealtime } from "../src/services/realtime.js";

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

/**
 * Ticket 01 — Closed ≠ Paused: stop/start accepting tokens, drain, catalog honesty.
 * Seam: queue HTTP surface (join, catalog, status, admin control).
 */
describe("Closed join gate + drain (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
    attachRealtime(null);
  });

  describe("role gates", () => {
    it("rejects unauthenticated and non-admin stop/start accepting", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const stop = `/api/admin/queues/${queueId}/stop-accepting`;
      const start = `/api/admin/queues/${queueId}/start-accepting`;

      assert.equal((await request(app).post(stop)).status, 401);
      assert.equal((await request(app).post(start)).status, 401);

      const { token: userToken } = await registerUser(app);
      assert.equal(
        (await request(app).post(stop).set("Authorization", `Bearer ${userToken}`)).status,
        403
      );
      assert.equal(
        (await request(app).post(start).set("Authorization", `Bearer ${userToken}`)).status,
        403
      );
    });
  });

  describe("accepting tokens model + admin stop/start", () => {
    it("seeded queues accept tokens by default (independent of pause status)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(list.status, 200);
      assert.equal(list.body.queue.status, "open");
      assert.equal(list.body.queue.acceptingTokens, true);
    });

    it("admin stop accepting tokens → Closed; start accepting → open for join again", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      const stop = await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(stop.status, 200);
      assert.equal(stop.body.queue.acceptingTokens, false);
      // Advancement status is orthogonal — still open (not paused).
      assert.equal(stop.body.queue.status, "open");

      const rejected = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(rejected.status, 409);
      assert.ok(typeof rejected.body.error === "string");
      assert.ok(/closed|not accepting|accepting tokens/i.test(rejected.body.error));

      const start = await request(app)
        .post(`/api/admin/queues/${queueId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      assert.equal(start.status, 200);
      assert.equal(start.body.queue.acceptingTokens, true);

      const joined = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(joined.status, 201);
      assert.equal(joined.body.tokenNumber, 1);
    });

    it("stop/start accepting are idempotent", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const stop1 = await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      const stop2 = await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(stop1.status, 200);
      assert.equal(stop2.status, 200);
      assert.equal(stop2.body.queue.acceptingTokens, false);

      const start1 = await request(app)
        .post(`/api/admin/queues/${queueId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      const start2 = await request(app)
        .post(`/api/admin/queues/${queueId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(start1.status, 200);
      assert.equal(start2.status, 200);
      assert.equal(start2.body.queue.acceptingTokens, true);
    });
  });

  describe("Closed ≠ Paused join rules", () => {
    it("paused only → User join still succeeds; Serve still blocked", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      const pause = await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(pause.status, 200);
      assert.equal(pause.body.queue.status, "paused");
      assert.equal(pause.body.queue.acceptingTokens, true);

      const joined = await joinQueue(app, userToken, queueId);
      assert.equal(joined.queue.status, "paused");
      assert.equal(joined.queue.acceptingTokens, true);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 409);
      assert.ok(/pause/i.test(serve.body.error));
    });

    it("rejects Guest app join while Closed with a clear reason", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const guestJoin = await request(app).post(`/api/queues/${queueId}/join`);
      assert.equal(guestJoin.status, 409);
      assert.ok(typeof guestJoin.body.error === "string");
      assert.ok(/closed|not accepting|accepting tokens/i.test(guestJoin.body.error));
    });
  });

  describe("drain while Closed", () => {
    it("Closed + waiting list → Serve/Skip still work; waiters not mass-cancelled", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: t1 } = await registerUser(app, "a@example.com", "Alice");
      const { token: t2 } = await registerUser(app, "b@example.com", "Bob");

      await joinQueue(app, t1, queueId);
      await joinQueue(app, t2, queueId);

      const stop = await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(stop.status, 200);
      assert.equal(stop.body.queue.acceptingTokens, false);

      // Waiting memberships preserved (drain).
      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 2);
      assert.equal(list.body.queue.acceptingTokens, false);

      const status1 = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${t1}`);
      assert.equal(status1.status, 200);
      assert.equal(status1.body.status, "waiting");
      assert.equal(status1.body.queue.acceptingTokens, false);
      assert.equal(status1.body.position, 1);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 200);
      assert.equal(serve.body.served.tokenNumber, 1);
      assert.equal(serve.body.queue.acceptingTokens, false);

      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(skip.status, 200);
      assert.equal(skip.body.skipped.tokenNumber, 2);

      const remaining = await QueueEntry.countDocuments({
        queue: queueId,
        status: "waiting",
      });
      assert.equal(remaining, 0);
    });

    it("Closed + Paused → join rejected; Serve/Skip blocked", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await joinQueue(app, userToken, queueId);

      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      await request(app)
        .post(`/api/admin/queues/${queueId}/pause`)
        .set("Authorization", `Bearer ${adminToken}`);

      const { token: outsider } = await registerUser(app, "out@example.com", "Outsider");
      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${outsider}`);
      assert.equal(join.status, 409);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 409);

      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(skip.status, 409);

      // Original waiter still draining (not cancelled).
      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.status, "waiting");
      assert.equal(status.body.queue.status, "paused");
      assert.equal(status.body.queue.acceptingTokens, false);
    });

    it("Walk-in while Closed creates a membership; app join still rejected", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Counter Walk-in" });
      assert.equal(walk.status, 201);
      assert.equal(walk.body.entry.tokenNumber, 1);
      assert.equal(walk.body.queue.acceptingTokens, false);

      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 409);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].isWalkIn, true);
    });
  });

  describe("Reset stays distinct from stop accepting", () => {
    it("stop accepting does not clear the waiting list or renumber", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await joinQueue(app, userToken, queueId);

      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.body.waiting.length, 1);
      assert.equal(list.body.waiting[0].tokenNumber, 1);

      const dbQueue = await Queue.findById(queueId);
      assert.equal(dbQueue.nextTokenNumber, 2);
      assert.equal(dbQueue.acceptingTokens, false);
    });

    it("Reset clears the line and renumbers but does not start accepting tokens", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await joinQueue(app, userToken, queueId);
      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const reset = await request(app)
        .post(`/api/admin/queues/${queueId}/reset`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(reset.status, 200);
      assert.equal(reset.body.cleared, 1);
      assert.equal(reset.body.queue.status, "open");
      assert.equal(reset.body.queue.nowServing, null);
      // Reset is not start-accepting: queue stays Closed for app join.
      assert.equal(reset.body.queue.acceptingTokens, false);

      const { token: outsider } = await registerUser(app, "after-reset@example.com", "After");
      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${outsider}`);
      assert.equal(join.status, 409);

      const dbQueue = await Queue.findById(queueId);
      assert.equal(dbQueue.nextTokenNumber, 1);
      assert.equal(dbQueue.acceptingTokens, false);
    });
  });

  describe("catalog and live status honesty", () => {
    it("catalog lists Closed queues (does not hide them) with acceptingTokens false", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const catalog = await request(app).get("/api/queues");
      assert.equal(catalog.status, 200);
      assert.equal(catalog.body.queues.length, 2);

      const cafeteria = catalog.body.queues.find((q) => q.id === queueId);
      assert.ok(cafeteria);
      assert.equal(cafeteria.acceptingTokens, false);
      // status remains open/paused (advancement), not a synonym for Closed.
      assert.equal(cafeteria.status, "open");

      const gym = catalog.body.queues.find((q) => q.name === "Gym");
      assert.ok(gym);
      assert.equal(gym.acceptingTokens, true);
    });

    it("live status shows Closed honesty for joiners still in line (drain-safe)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await joinQueue(app, userToken, queueId);
      await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.status, "waiting");
      assert.equal(status.body.queue.acceptingTokens, false);
      assert.equal(status.body.queue.status, "open");
      // Still has a place — not cancelled.
      assert.equal(status.body.tokenNumber, 1);
      assert.equal(status.body.position, 1);
    });
  });

  describe("realtime on accepting transitions", () => {
    it("stop/start accepting emit queue:changed with their change labels", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      /** @type {{ event: string, payload: object }[]} */
      let emittedEvents = [];
      const fakeIo = {
        to() {
          return {
            emit(event, payload) {
              emittedEvents.push({ event, payload });
            },
          };
        },
      };
      attachRealtime(fakeIo);

      emittedEvents = [];
      const stop = await request(app)
        .post(`/api/admin/queues/${queueId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(stop.status, 200);
      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].event, "queue:changed");
      assert.equal(emittedEvents[0].payload.change, "stop-accepting");
      assert.equal(emittedEvents[0].payload.queueId, queueId);

      emittedEvents = [];
      const start = await request(app)
        .post(`/api/admin/queues/${queueId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(start.status, 200);
      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].payload.change, "start-accepting");

      attachRealtime(null);
    });
  });
});
