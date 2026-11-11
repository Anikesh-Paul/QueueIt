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

async function createLibraryQueue() {
  const venue = await Venue.create({ name: "Library Annex", slug: "library-annex" });
  const queue = await Queue.create({
    name: "Holds desk",
    slug: "holds-desk",
    venue: venue._id,
    averageServiceTime: 4,
    status: "open",
    acceptingTokens: true,
    counters: [{ name: "Counter 1", nowServing: null }],
  });
  return { venue, queue };
}

describe("Venue-scoped staff vs global admin", () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("keeps the seeded demo admin global and hides other venues from staff", async () => {
    const { venue: campus } = await seedVenueAndQueues();
    const { venue: library, queue: holds } = await createLibraryQueue();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });

    await User.create({
      email: "admin@example.com",
      name: "Demo Admin",
      passwordHash: await User.hashPassword("password123"),
      role: "admin",
    });
    await User.create({
      email: "cafeteria-staff@example.com",
      name: "Cafe Staff",
      passwordHash: await User.hashPassword("password123"),
      role: "staff",
      staffVenue: campus._id,
    });

    const app = testApp();
    const admin = await login(app, "admin@example.com", "password123");
    const staff = await login(app, "cafeteria-staff@example.com", "password123");

    const adminMe = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${admin}`);
    assert.equal(adminMe.body.user.role, "admin");
    assert.equal(adminMe.body.user.staffVenueId, null);

    const staffMe = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${staff}`);
    assert.equal(staffMe.body.user.role, "staff");
    assert.equal(staffMe.body.user.staffVenueId, campus._id.toString());

    const staffCatalog = await request(app)
      .get("/api/admin/catalog")
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(staffCatalog.status, 200);
    assert.equal(staffCatalog.body.venues.length, 1);
    assert.equal(staffCatalog.body.venues[0].id, campus._id.toString());
    assert.ok(staffCatalog.body.venues[0].queues.every((q) => q.venue.id === campus._id.toString()));

    const adminCatalog = await request(app)
      .get("/api/admin/catalog")
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(adminCatalog.status, 200);
    assert.equal(adminCatalog.body.venues.length, 2);
    assert.ok(adminCatalog.body.venues.some((v) => v.id === library._id.toString()));

    const staffCreateVenue = await request(app)
      .post("/api/admin/venues")
      .set("Authorization", `Bearer ${staff}`)
      .send({ name: "Should not exist" });
    assert.equal(staffCreateVenue.status, 403);

    const staffOtherQueue = await request(app)
      .post(`/api/admin/queues/${holds._id}/pause`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(staffOtherQueue.status, 403);
    assert.match(staffOtherQueue.body.error, /access/i);

    const staffOwn = await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/pause`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(staffOwn.status, 200);
    assert.equal(staffOwn.body.queue.status, "paused");

    const adminOther = await request(app)
      .post(`/api/admin/queues/${holds._id}/pause`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});
    assert.equal(adminOther.status, 200);
    assert.equal(adminOther.body.queue.status, "paused");
  });

  it("does not let a student through the console gate, and staff cannot serve or reset another venue", async () => {
    await seedVenueAndQueues();
    const campus = await Venue.findOne({ slug: "campus-hub" });
    const { queue: holds } = await createLibraryQueue();

    const student = await User.create({
      email: "student@example.com",
      name: "Student",
      passwordHash: await User.hashPassword("password123"),
      role: "user",
    });
    await User.create({
      email: "cafeteria-staff@example.com",
      name: "Cafe Staff",
      passwordHash: await User.hashPassword("password123"),
      role: "staff",
      staffVenue: campus._id,
    });

    const app = testApp();
    const studentToken = await login(app, "student@example.com", "password123");
    const staff = await login(app, "cafeteria-staff@example.com", "password123");

    const studentPause = await request(app)
      .post(`/api/admin/queues/${holds._id}/pause`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({});
    assert.equal(studentPause.status, 403);
    assert.equal(studentPause.body.error, "Admin access required");

    const staffServe = await request(app)
      .post(`/api/admin/queues/${holds._id}/serve`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(staffServe.status, 403);

    const staffReset = await request(app)
      .post(`/api/admin/queues/${holds._id}/reset`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(staffReset.status, 403);

    // Unused local to satisfy linters if student is flagged.
    assert.equal(student.role, "user");
  });
});
