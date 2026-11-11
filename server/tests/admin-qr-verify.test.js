import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { signArrivalPass } from "../src/services/arrivalPass.js";

async function registerUser(app, email = "qr-user@example.com", name = "QR User") {
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
  const { User } = await import("../src/models/User.js");
  const passwordHash = await User.hashPassword(password);
  await User.create({ email, name: "Admin", passwordHash, role: "admin" });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return { token: res.body.token, user: res.body.user };
}

async function seedAndGetCafeteriaId() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria._id.toString();
}

/** Full QR pass string in the shipped format. */
function arrivalPass(queueId, tokenNumber) {
  return `QIT:${queueId}:${tokenNumber}`;
}

/**
 * Stretch: QR arrival check — a user shows a QR for their token; an admin
 * matches it at the counter for arrival confirmation.
 * POST /api/admin/queues/:queueId/verify-qr
 * Body: { value } — signed or legacy QR payload, or a bare token number typed
 * at the counter. A match means the token is waiting, not proof of identity.
 */
describe("Admin QR arrival check (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("role gates", () => {
    it("rejects unauthenticated and non-admin verify", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const path = `/api/admin/queues/${queueId}/verify-qr`;

      assert.equal((await request(app).post(path).send({ value: "1" })).status, 401);

      const { token: userToken } = await registerUser(app);
      assert.equal(
        (
          await request(app)
            .post(path)
            .set("Authorization", `Bearer ${userToken}`)
            .send({ value: "1" })
        ).status,
        403
      );
    });

    it("returns 404 for an unknown queue", async () => {
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const res = await request(app)
        .post("/api/admin/queues/aaaaaaaaaaaaaaaaaaaaaaaa/verify-qr")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "1" });
      assert.equal(res.status, 404);
    });
  });

  describe("POST /api/admin/queues/:queueId/verify-qr", () => {
    it("verifies an app-joined waiter by bare token number", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 201);
      assert.equal(join.body.tokenNumber, 1);

      const verify = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "1" });

      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, true);
      assert.equal(verify.body.entry.tokenNumber, 1);
      assert.equal(verify.body.entry.position, 1);
      assert.equal(verify.body.entry.isWalkIn, false);
      assert.equal(verify.body.entry.user.name, "QR User");
      assert.equal(verify.body.entry.user.email, "qr-user@example.com");
      assert.equal(verify.body.queue.name, "Cafeteria");
      assert.equal(verify.body.queue.id, queueId);
    });

    it("verifies by the full QR payload and reports live position", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      // Two waiters so position is meaningful.
      const { token: firstToken } = await registerUser(app, "first@example.com", "First");
      const { token: secondToken } = await registerUser(app, "second@example.com", "Second");
      await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${firstToken}`);
      const second = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${secondToken}`);
      assert.equal(second.status, 201);

      const verify = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: arrivalPass(queueId, second.body.tokenNumber) });

      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, true);
      assert.equal(verify.body.entry.tokenNumber, second.body.tokenNumber);
      assert.equal(verify.body.entry.position, 2);
      assert.equal(verify.body.entry.user.name, "Second");
    });

    it("verifies a walk-in entry by token", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const walk = await request(app)
        .post(`/api/admin/queues/${queueId}/walk-in`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Counter Guest" });
      assert.equal(walk.status, 201);

      const verify = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: String(walk.body.entry.tokenNumber) });

      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, true);
      assert.equal(verify.body.entry.isWalkIn, true);
      assert.equal(verify.body.entry.user.name, "Counter Guest");
      assert.equal(verify.body.entry.user.email, null);
    });

    it("does not verify tokens that left the waiting list (served)", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const { token: userToken } = await registerUser(app);

      await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${userToken}`);
      const serve = await request(app)
        .post(`/api/admin/queues/${queueId}/serve`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(serve.status, 200);

      const verify = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: "1" });
      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, false);
      assert.match(verify.body.reason, /no one waiting/i);
    });

    it("reports a pass for a different queue as a mismatch", async () => {
      await seedVenueAndQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const cafeteria = await Queue.findOne({ slug: "cafeteria" });
      const gym = await Queue.findOne({ slug: "gym" });
      const { token: userToken } = await registerUser(app);
      const join = await request(app)
        .post(`/api/queues/${cafeteria._id}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 201);

      // The user holds token for Cafeteria; admin scans into the Gym console.
      const verify = await request(app)
        .post(`/api/admin/queues/${gym._id}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: arrivalPass(cafeteria._id.toString(), join.body.tokenNumber) });

      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, false);
      assert.match(verify.body.reason, /different queue/i);
    });

    it("treats malformed values as a mismatch, not an error", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      for (const value of ["hello", "QIT:", "QIT:zz:5", "QIT:5f0c12345:abc", "12.5", "-3", "0x10", "1e3"]) {
        const verify = await request(app)
          .post(`/api/admin/queues/${queueId}/verify-qr`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ value });
        assert.equal(verify.status, 200, `value "${value}" should be a mismatch`);
        assert.equal(verify.body.verified, false);
        assert.ok(verify.body.reason, `reason expected for "${value}"`);
      }
    });

    it("requires a non-empty value in the body", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);
      const path = `/api/admin/queues/${queueId}/verify-qr`;

      assert.equal((await request(app).post(path).set("Authorization", `Bearer ${adminToken}`).send({})).status, 400);
      assert.equal(
        (
          await request(app)
            .post(path)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({ value: "   " })
        ).status,
        400
      );
    });

    it("verifies a signed pass issued at join", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: userToken } = await registerUser(app);
      const { token: adminToken } = await createAdmin(app);

      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 201);
      assert.equal(join.body.arrivalPass, signArrivalPass(queueId, join.body.tokenNumber));

      const verify = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: join.body.arrivalPass });

      assert.equal(verify.status, 200);
      assert.equal(verify.body.verified, true);
      assert.equal(verify.body.signed, true);
      assert.equal(verify.body.entry.tokenNumber, join.body.tokenNumber);
    });

    it("rejects a tampered signed pass and still accepts a bare token", async () => {
      const queueId = await seedAndGetCafeteriaId();
      const app = testApp();
      const { token: userToken } = await registerUser(app);
      const { token: adminToken } = await createAdmin(app);

      const join = await request(app)
        .post(`/api/queues/${queueId}/join`)
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(join.status, 201);
      const tampered = join.body.arrivalPass.slice(0, -1) + (join.body.arrivalPass.endsWith("a") ? "b" : "a");

      const bad = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: tampered });
      assert.equal(bad.status, 200);
      assert.equal(bad.body.verified, false);
      assert.match(bad.body.reason, /not valid/i);

      const bare = await request(app)
        .post(`/api/admin/queues/${queueId}/verify-qr`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ value: String(join.body.tokenNumber) });
      assert.equal(bare.status, 200);
      assert.equal(bare.body.verified, true);
      assert.equal(bare.body.signed, false);
    });
  });
});
