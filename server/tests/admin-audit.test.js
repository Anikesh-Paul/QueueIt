import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";

async function login(app, email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function createAdmin(app, email = "admin@example.com") {
  await User.create({
    email,
    name: "Admin",
    passwordHash: await User.hashPassword("password123"),
    role: "admin",
  });
  return login(app, email, "password123");
}

describe("Admin audit log", () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("records who / what / when on pause and refuses off-venue staff reads", async () => {
    const { venue: campus } = await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const library = await Venue.create({ name: "Library Annex", slug: "library-annex" });
    await User.create({
      email: "cafeteria-staff@example.com",
      name: "Cafe Staff",
      passwordHash: await User.hashPassword("password123"),
      role: "staff",
      staffVenue: campus._id,
    });
    await User.create({
      email: "library-staff@example.com",
      name: "Library Staff",
      passwordHash: await User.hashPassword("password123"),
      role: "staff",
      staffVenue: library._id,
    });

    const app = testApp();
    const admin = await createAdmin(app);
    const cafeStaff = await login(app, "cafeteria-staff@example.com", "password123");
    const libraryStaff = await login(app, "library-staff@example.com", "password123");

    const paused = await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/pause`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(paused.status, 200);

    const windows = await request(app)
      .put(`/api/admin/queues/${cafeteria._id}/service-windows`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ serviceWindows: [{ start: "11:30", end: "14:30" }] });
    assert.equal(windows.status, 200);

    const log = await request(app)
      .get(`/api/admin/audit?queueId=${cafeteria._id}`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(log.status, 200);
    assert.ok(log.body.events.length >= 2);
    const actions = log.body.events.map((row) => row.action);
    assert.ok(actions.includes("pause"));
    assert.ok(actions.includes("service-windows"));
    const pause = log.body.events.find((row) => row.action === "pause");
    assert.equal(pause.actor.email, "admin@example.com");
    assert.equal(pause.queue.id, cafeteria._id.toString());
    assert.equal(pause.venue.id, campus._id.toString());
    assert.ok(pause.createdAt);

    const sameVenue = await request(app)
      .get(`/api/admin/audit?queueId=${cafeteria._id}`)
      .set("Authorization", `Bearer ${cafeStaff}`);
    assert.equal(sameVenue.status, 200);
    assert.ok(sameVenue.body.events.some((row) => row.action === "pause"));

    const offVenue = await request(app)
      .get(`/api/admin/audit?queueId=${cafeteria._id}`)
      .set("Authorization", `Bearer ${libraryStaff}`);
    assert.equal(offVenue.status, 403);

    const student = await request(app).post("/api/auth/register").send({
      email: "student@example.com",
      password: "password123",
      name: "Student",
    });
    assert.equal(student.status, 201);
    const studentLog = await request(app)
      .get("/api/admin/audit")
      .set("Authorization", `Bearer ${student.body.token}`);
    assert.equal(studentLog.status, 403);
  });
});
