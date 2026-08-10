import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { Guest } from "../src/models/Guest.js";
import { User } from "../src/models/User.js";

const GUEST_HEADER = "X-Guest-Credential";

async function seedAndGetQueues() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  const gym = await Queue.findOne({ slug: "gym" });
  assert.ok(cafeteria && gym);
  return {
    cafeteriaId: cafeteria._id.toString(),
    gymId: gym._id.toString(),
  };
}

async function createAdmin(app, email = "admin-soft@example.com") {
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

describe("Soft upgrade (claim Guest onto User + retire credential)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("POST /api/auth/register with Guest credential", () => {
    it("claims active memberships + device-local history and retires Guest", async () => {
      const { cafeteriaId, gymId } = await seedAndGetQueues();
      const app = testApp();

      const joinCafe = await request(app).post(`/api/queues/${cafeteriaId}/join`);
      assert.equal(joinCafe.status, 201);
      const credential = joinCafe.body.guestCredential;
      const cafeToken = joinCafe.body.tokenNumber;

      const joinGym = await request(app)
        .post(`/api/queues/${gymId}/join`)
        .set(GUEST_HEADER, credential);
      assert.equal(joinGym.status, 201);

      await request(app)
        .post(`/api/queues/${gymId}/leave`)
        .set(GUEST_HEADER, credential);

      const register = await request(app)
        .post("/api/auth/register")
        .set(GUEST_HEADER, credential)
        .send({
          email: "upgrade-reg@example.com",
          password: "password123",
          name: "Upgraded Student",
        });

      assert.equal(register.status, 201);
      assert.equal(typeof register.body.token, "string");
      assert.equal(register.body.user.role, "user");
      assert.equal(register.body.softUpgrade?.claimed, 2);

      const guest = await Guest.findOne({ credential });
      assert.ok(guest);
      assert.ok(guest.retiredAt);

      // Retired credential no longer powers Guest path.
      const deadStatus = await request(app)
        .get(`/api/queues/${cafeteriaId}/status`)
        .set(GUEST_HEADER, credential);
      assert.equal(deadStatus.status, 401);

      // Claimed active membership is User-owned.
      const userStatus = await request(app)
        .get(`/api/queues/${cafeteriaId}/status`)
        .set("Authorization", `Bearer ${register.body.token}`);
      assert.equal(userStatus.status, 200);
      assert.equal(userStatus.body.tokenNumber, cafeToken);

      // Claimed history (left gym + joined cafeteria) under User History.
      const history = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${register.body.token}`);
      assert.equal(history.status, 200);
      assert.equal(history.body.events.length, 2);
      const outcomes = history.body.events.map((e) => e.outcome).sort();
      assert.deepEqual(outcomes, ["joined", "left"]);

      const entries = await QueueEntry.find({ guest: guest._id });
      assert.equal(entries.length, 0);
      const userEntries = await QueueEntry.find({ user: register.body.user.id });
      assert.equal(userEntries.length, 2);
    });

    it("register without Guest credential still works (no claim)", async () => {
      await seedAndGetQueues();
      const app = testApp();

      const res = await request(app).post("/api/auth/register").send({
        email: "plain@example.com",
        password: "password123",
        name: "Plain",
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.softUpgrade, undefined);
    });
  });

  describe("POST /api/auth/login with Guest credential", () => {
    it("claims memberships + history onto existing User and retires Guest", async () => {
      const { cafeteriaId } = await seedAndGetQueues();
      const app = testApp();

      const reg = await request(app).post("/api/auth/register").send({
        email: "upgrade-login@example.com",
        password: "password123",
        name: "Existing User",
      });
      assert.equal(reg.status, 201);

      const join = await request(app).post(`/api/queues/${cafeteriaId}/join`);
      assert.equal(join.status, 201);
      const credential = join.body.guestCredential;
      const tokenNumber = join.body.tokenNumber;

      const login = await request(app)
        .post("/api/auth/login")
        .set(GUEST_HEADER, credential)
        .send({
          email: "upgrade-login@example.com",
          password: "password123",
        });

      assert.equal(login.status, 200);
      assert.equal(login.body.softUpgrade?.claimed, 1);

      const guest = await Guest.findOne({ credential });
      assert.ok(guest.retiredAt);

      const status = await request(app)
        .get(`/api/queues/${cafeteriaId}/status`)
        .set("Authorization", `Bearer ${login.body.token}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.tokenNumber, tokenNumber);

      const history = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${login.body.token}`);
      assert.equal(history.status, 200);
      assert.ok(history.body.events.some((e) => e.tokenNumber === tokenNumber));
    });

    it("ignores unknown or already-retired Guest credentials on login", async () => {
      await seedAndGetQueues();
      const app = testApp();

      await request(app).post("/api/auth/register").send({
        email: "ignore-guest@example.com",
        password: "password123",
        name: "User",
      });

      const res = await request(app)
        .post("/api/auth/login")
        .set(GUEST_HEADER, "not-a-real-credential-aaaaaaaa")
        .send({
          email: "ignore-guest@example.com",
          password: "password123",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.softUpgrade, undefined);
    });
  });

  describe("admin view after claim", () => {
    it("shows claimed membership as normal User row (not Guest)", async () => {
      const { cafeteriaId } = await seedAndGetQueues();
      const app = testApp();
      const adminToken = await createAdmin(app);

      const join = await request(app).post(`/api/queues/${cafeteriaId}/join`);
      const credential = join.body.guestCredential;
      const tokenNumber = join.body.tokenNumber;

      const before = await request(app)
        .get(`/api/admin/queues/${cafeteriaId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(before.body.waiting[0].isGuest, true);

      const register = await request(app)
        .post("/api/auth/register")
        .set(GUEST_HEADER, credential)
        .send({
          email: "claimed-row@example.com",
          password: "password123",
          name: "Claimed Name",
        });
      assert.equal(register.status, 201);

      const after = await request(app)
        .get(`/api/admin/queues/${cafeteriaId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(after.status, 200);
      const row = after.body.waiting.find((r) => r.tokenNumber === tokenNumber);
      assert.ok(row);
      assert.equal(row.isGuest, false);
      assert.equal(row.isWalkIn, false);
      assert.equal(row.user.name, "Claimed Name");
      assert.equal(row.user.email, "claimed-row@example.com");
    });
  });

  describe("active membership conflict", () => {
    it("keeps User active place and claims Guest active as left history", async () => {
      const { cafeteriaId } = await seedAndGetQueues();
      const app = testApp();

      const reg = await request(app).post("/api/auth/register").send({
        email: "conflict@example.com",
        password: "password123",
        name: "Conflict User",
      });
      const userToken = reg.body.token;

      const userJoin = await request(app)
        .post(`/api/queues/${cafeteriaId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(userJoin.status, 201);
      const userTokenNumber = userJoin.body.tokenNumber;

      const guestJoin = await request(app).post(`/api/queues/${cafeteriaId}/join`);
      assert.equal(guestJoin.status, 201);
      const credential = guestJoin.body.guestCredential;
      const guestTokenNumber = guestJoin.body.tokenNumber;

      const login = await request(app)
        .post("/api/auth/login")
        .set(GUEST_HEADER, credential)
        .send({
          email: "conflict@example.com",
          password: "password123",
        });
      assert.equal(login.status, 200);
      assert.equal(login.body.softUpgrade?.claimed, 1);

      const status = await request(app)
        .get(`/api/queues/${cafeteriaId}/status`)
        .set("Authorization", `Bearer ${login.body.token}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.tokenNumber, userTokenNumber);

      const history = await request(app)
        .get("/api/queues/history")
        .set("Authorization", `Bearer ${login.body.token}`);
      const guestClaimed = history.body.events.find((e) => e.tokenNumber === guestTokenNumber);
      assert.ok(guestClaimed);
      assert.equal(guestClaimed.outcome, "left");
    });
  });

  describe("optional forever", () => {
    it("Guest can still join/leave without soft upgrade", async () => {
      const { cafeteriaId } = await seedAndGetQueues();
      const app = testApp();

      const join = await request(app).post(`/api/queues/${cafeteriaId}/join`);
      assert.equal(join.status, 201);
      const credential = join.body.guestCredential;

      const leave = await request(app)
        .post(`/api/queues/${cafeteriaId}/leave`)
        .set(GUEST_HEADER, credential);
      assert.equal(leave.status, 200);

      const guest = await Guest.findOne({ credential });
      assert.equal(guest.retiredAt, null);
    });
  });
});
