import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { Guest } from "../src/models/Guest.js";

const GUEST_HEADER = "X-Guest-Credential";

async function seedAndGetCafeteriaId() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria._id.toString();
}

async function createAdmin(app, email = "admin-guest@example.com") {
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
  return res.body.token;
}

async function registerUser(app, email = "user-guest@example.com", name = "User Peer") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

describe("Guest join path (credential, live status, device-local history)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("GET /api/queues catalog", () => {
    it("allows catalog browse without auth or Guest credential", async () => {
      await seedVenueAndQueues();
      const app = testApp();

      const res = await request(app).get("/api/queues");

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.queues));
      assert.equal(res.body.queues.length, 2);
    });
  });

  describe("POST /api/queues/:queueId/join as Guest", () => {
    it("mints a Guest credential on first join and returns live status", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      const res = await request(app).post(`/api/queues/${queueId}/join`);

      assert.equal(res.status, 201);
      assert.equal(res.body.tokenNumber, 1);
      assert.equal(res.body.position, 1);
      assert.equal(res.body.status, "waiting");
      assert.equal(res.body.queue.id, queueId);
      assert.equal(typeof res.body.guestCredential, "string");
      assert.ok(res.body.guestCredential.length >= 32);
      assert.equal(res.body.guestCredentialMinted, true);

      const guests = await Guest.find();
      assert.equal(guests.length, 1);
      assert.equal(guests[0].credential, res.body.guestCredential);

      const entry = await QueueEntry.findOne({ tokenNumber: 1 });
      assert.ok(entry);
      assert.equal(entry.user, null);
      assert.ok(entry.guest);
      assert.equal(entry.isWalkIn, false);
    });

    it("reuses credential on second join to another queue; peer fairness per queue", async () => {
      await seedVenueAndQueues();
      const cafeteria = await Queue.findOne({ slug: "cafeteria" });
      const gym = await Queue.findOne({ slug: "gym" });
      const app = testApp();

      const first = await request(app).post(`/api/queues/${cafeteria._id}/join`);
      assert.equal(first.status, 201);
      const credential = first.body.guestCredential;

      const again = await request(app)
        .post(`/api/queues/${cafeteria._id}/join`)
        .set(GUEST_HEADER, credential);
      assert.equal(again.status, 409);
      assert.equal(again.body.error, "Already in this queue");

      const gymJoin = await request(app)
        .post(`/api/queues/${gym._id}/join`)
        .set(GUEST_HEADER, credential);
      assert.equal(gymJoin.status, 201);
      assert.equal(gymJoin.body.guestCredential, credential);

      const guestCount = await Guest.countDocuments();
      assert.equal(guestCount, 1);
    });
  });

  describe("status / leave / history", () => {
    it("polls live status and leaves with the same Guest credential", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      const join = await request(app).post(`/api/queues/${queueId}/join`);
      assert.equal(join.status, 201);
      const credential = join.body.guestCredential;
      const tokenNumber = join.body.tokenNumber;

      const status = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set(GUEST_HEADER, credential);
      assert.equal(status.status, 200);
      assert.equal(status.body.tokenNumber, tokenNumber);
      assert.equal(status.body.position, 1);

      const leave = await request(app)
        .post(`/api/queues/${queueId}/leave`)
        .set(GUEST_HEADER, credential);
      assert.equal(leave.status, 200);
      assert.equal(leave.body.status, "left");

      const after = await request(app)
        .get(`/api/queues/${queueId}/status`)
        .set(GUEST_HEADER, credential);
      assert.equal(after.status, 404);
    });

    it("returns device-local history for the Guest credential", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      const join = await request(app).post(`/api/queues/${queueId}/join`);
      const credential = join.body.guestCredential;

      await request(app).post(`/api/queues/${queueId}/leave`).set(GUEST_HEADER, credential);

      const history = await request(app)
        .get("/api/queues/history")
        .set(GUEST_HEADER, credential);
      assert.equal(history.status, 200);
      assert.ok(Array.isArray(history.body.events));
      assert.equal(history.body.events.length, 1);
      assert.equal(history.body.events[0].outcome, "left");
      assert.equal(history.body.events[0].tokenNumber, join.body.tokenNumber);
    });

    it("rejects leave/status/history without identity", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();

      assert.equal((await request(app).post(`/api/queues/${queueId}/leave`)).status, 401);
      assert.equal((await request(app).get(`/api/queues/${queueId}/status`)).status, 401);
      assert.equal((await request(app).get("/api/queues/history")).status, 401);
    });
  });

  describe("admin waiting list + ops for Guest", () => {
    it("lists Guest rows token-first with isGuest, not walk-in", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const adminToken = await createAdmin(app);

      const join = await request(app).post(`/api/queues/${queueId}/join`);
      assert.equal(join.status, 201);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.status, 200);
      assert.equal(list.body.waiting.length, 1);
      const row = list.body.waiting[0];
      assert.equal(row.tokenNumber, join.body.tokenNumber);
      assert.equal(row.isGuest, true);
      assert.equal(row.isWalkIn, false);
      assert.equal(row.user.name, null);
      assert.equal(row.user.email, null);
    });

    it("keeps walk-in distinct from Guest on the waiting list", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const adminToken = await createAdmin(app);

      await request(app).post(`/api/queues/${queueId}/join`);
      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Counter Walk-in" });
      assert.equal(walk.status, 201);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.status, 200);
      assert.equal(list.body.waiting.length, 2);

      const guestRow = list.body.waiting.find((r) => r.isGuest);
      const walkRow = list.body.waiting.find((r) => r.isWalkIn);
      assert.ok(guestRow);
      assert.ok(walkRow);
      assert.equal(guestRow.isWalkIn, false);
      assert.equal(walkRow.isGuest, false);
      assert.equal(walkRow.user.name, "Counter Walk-in");
    });

    it("serve / skip / verify-qr work for Guest memberships", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const adminToken = await createAdmin(app);

      const joinA = await request(app).post(`/api/queues/${queueId}/join`);
      const joinB = await request(app).post(`/api/queues/${queueId}/join`);
      const tokenA = joinA.body.tokenNumber;
      const credentialA = joinA.body.guestCredential;
      const credentialB = joinB.body.guestCredential;

      const verify = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: `QIT:${queueId}:${tokenA}` });
      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, true);
      assert.equal(verify.body.entry.tokenNumber, tokenA);
      assert.equal(verify.body.entry.isGuest, true);
      assert.equal(verify.body.entry.isWalkIn, false);

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      const entryA = list.body.waiting.find((r) => r.tokenNumber === tokenA);
      const entryB = list.body.waiting.find((r) => r.tokenNumber === joinB.body.tokenNumber);
      assert.ok(entryA && entryB);

      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ entryId: entryA.id });
      assert.equal(serve.status, 200);

      const skip = await request(app)
        .post(`/api/admin/queues/${queueId}/skip`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ entryId: entryB.id });
      assert.equal(skip.status, 200);

      const historyA = await request(app)
        .get("/api/queues/history")
        .set(GUEST_HEADER, credentialA);
      assert.equal(historyA.status, 200);
      assert.equal(historyA.body.events[0].outcome, "served");

      const historyB = await request(app)
        .get("/api/queues/history")
        .set(GUEST_HEADER, credentialB);
      assert.equal(historyB.status, 200);
      assert.equal(historyB.body.events[0].outcome, "skipped");
    });

    it("Guest cannot access admin console APIs", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const join = await request(app).post(`/api/queues/${queueId}/join`);
      const credential = join.body.guestCredential;

      const list = await request(app)
        .get(`/api/admin/queues/${queueId}/waiting-list`)
        .set(GUEST_HEADER, credential);
      assert.equal(list.status, 401);

      const analytics = await request(app)
        .get(`/api/admin/queues/${queueId}/analytics`)
        .set(GUEST_HEADER, credential);
      assert.equal(analytics.status, 401);
    });
  });

  describe("JWT wins over Guest credential", () => {
    it("joins as User when Bearer is present even with Guest header", async () => {
      await seedVenueAndQueues();
      const cafeteria = await Queue.findOne({ slug: "cafeteria" });
      const gym = await Queue.findOne({ slug: "gym" });
      const app = testApp();
      const userToken = await registerUser(app);

      const guestJoin = await request(app).post(`/api/queues/${cafeteria._id}/join`);
      assert.equal(guestJoin.status, 201);

      const res = await request(app)
        .post(`/api/queues/${gym._id}/join`)
        .set("Authorization", `Bearer ${userToken}`)
        .set(GUEST_HEADER, guestJoin.body.guestCredential);
      assert.equal(res.status, 201);
      assert.equal(res.body.guestCredential, undefined);

      const entry = await QueueEntry.findOne({
        tokenNumber: res.body.tokenNumber,
        queue: gym._id,
      });
      assert.ok(entry.user);
      assert.equal(entry.guest, null);
    });
  });
});
