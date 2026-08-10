import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock } from "../src/services/clock.js";
import { attachRealtime } from "../src/services/realtime.js";

/**
 * Ticket 03 — Admin edit service windows.
 * Seam: Queue HTTP (admin control, catalog, start bind, stop reopen).
 */

const IST = {
  lunchMid: "2026-08-10T12:00:00+05:30",
  between: "2026-08-10T15:00:00+05:30",
  afterDinner: "2026-08-10T22:00:00+05:30",
};

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
  };
}

describe("Admin edit service windows (HTTP API)", () => {
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

  describe("get + update windows", () => {
    it("admin waiting-list exposes current service windows for the open queue", async () => {
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const list = await request(app)
        .get(`/api/admin/queues/${cafeteriaId}/waiting-list`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.queue.serviceWindows, [
        { start: "11:30", end: "14:30" },
        { start: "19:00", end: "21:00" },
      ]);
    });

    it("admin can replace windows; catalog reflects the new schedule", async () => {
      const { cafeteriaId, gymId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const updated = [
        { start: "10:00", end: "12:00" },
        { start: "18:00", end: "20:30" },
      ];
      const put = await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ serviceWindows: updated });
      assert.equal(put.status, 200);
      assert.deepEqual(put.body.queue.serviceWindows, updated);

      const catalog = await request(app).get("/api/queues");
      assert.equal(catalog.status, 200);
      const cafeteria = catalog.body.queues.find((q) => q.id === cafeteriaId);
      const gym = catalog.body.queues.find((q) => q.id === gymId);
      assert.deepEqual(cafeteria.serviceWindows, updated);
      // Other queues unchanged.
      assert.deepEqual(gym.serviceWindows, [{ start: "17:00", end: "21:00" }]);
    });

    it("rejects end-before-start and overlapping windows with clear errors", async () => {
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const badEnd = await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ serviceWindows: [{ start: "14:00", end: "12:00" }] });
      assert.equal(badEnd.status, 400);
      assert.match(badEnd.body.error || "", /end|start|before|after|invalid/i);

      const overlap = await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceWindows: [
            { start: "11:00", end: "14:00" },
            { start: "13:00", end: "16:00" },
          ],
        });
      assert.equal(overlap.status, 400);
      assert.match(overlap.body.error || "", /overlap/i);

      // Seeded schedule still intact after rejections.
      const catalog = await request(app).get("/api/queues");
      const cafeteria = catalog.body.queues.find((q) => q.id === cafeteriaId);
      assert.deepEqual(cafeteria.serviceWindows, [
        { start: "11:30", end: "14:30" },
        { start: "19:00", end: "21:00" },
      ]);
    });

    it("rejects non-admin callers", async () => {
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const reg = await request(app).post("/api/auth/register").send({
        email: "student@example.com",
        password: "password123",
        name: "Student",
      });
      assert.equal(reg.status, 201);

      const put = await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${reg.body.token}`)
        .send({ serviceWindows: [{ start: "09:00", end: "10:00" }] });
      assert.equal(put.status, 403);
    });
  });

  describe("effects on reopen and target bind", () => {
    it("after save while Closed, stop-default reopen follows the new next window", async () => {
      setNow(IST.lunchMid);
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      // Close with default reopen = dinner 19:00 under seed schedule.
      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      // Edit: only afternoon window 16:00–18:00.
      const put = await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceWindows: [{ start: "16:00", end: "18:00" }],
        });
      assert.equal(put.status, 200);
      assert.equal(
        new Date(put.body.queue.reopenAt).toISOString(),
        new Date("2026-08-10T16:00:00+05:30").toISOString()
      );

      const catalog = await request(app).get("/api/queues");
      const cafeteria = catalog.body.queues.find((q) => q.id === cafeteriaId);
      assert.equal(
        new Date(cafeteria.reopenAt).toISOString(),
        new Date("2026-08-10T16:00:00+05:30").toISOString()
      );
    });

    it("Start accepting tokens binds session end to the updated windows", async () => {
      setNow(IST.between); // 15:00 IST
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/stop-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);

      // Replace dinner with 16:00–17:30 so next target ends at 17:30.
      await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceWindows: [
            { start: "11:30", end: "14:30" },
            { start: "16:00", end: "17:30" },
          ],
        });

      const start = await request(app)
        .post(`/api/admin/queues/${cafeteriaId}/start-accepting`)
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(start.status, 200);
      assert.equal(start.body.queue.acceptingTokens, true);
      assert.equal(
        new Date(start.body.queue.sessionEndsAt).toISOString(),
        new Date("2026-08-10T17:30:00+05:30").toISOString()
      );
    });

    it("adjacent windows (end == next start) are allowed; multi-window preserved sorted", async () => {
      const { cafeteriaId } = await seedQueues();
      const app = testApp();
      const { token: adminToken } = await createAdmin(app);

      const put = await request(app)
        .put(`/api/admin/queues/${cafeteriaId}/service-windows`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceWindows: [
            { start: "19:00", end: "21:00" },
            { start: "11:00", end: "14:00" },
            { start: "14:00", end: "15:00" },
          ],
        });
      assert.equal(put.status, 200);
      assert.deepEqual(put.body.queue.serviceWindows, [
        { start: "11:00", end: "14:00" },
        { start: "14:00", end: "15:00" },
        { start: "19:00", end: "21:00" },
      ]);
    });
  });
});
