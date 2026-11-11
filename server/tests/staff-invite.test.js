import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { Queue } from "../src/models/Queue.js";
import { setMailer, resetMailer } from "../src/services/mailer.js";

async function login(app, email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function createAdmin(app) {
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword("password123"),
    role: "admin",
  });
  return login(app, "admin@example.com", "password123");
}

describe("Admin staff invite (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    resetMailer();
    await teardownTestDb();
  });

  beforeEach(async () => {
    resetMailer();
    await resetDb();
  });

  it("lets a global admin invite venue-scoped staff with a temporary password", async () => {
    const { venue } = await seedVenueAndQueues();
    const app = testApp();
    const admin = await createAdmin(app);

    const invited = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-staff@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
      });
    assert.equal(invited.status, 201);
    assert.equal(invited.body.staff.role, "staff");
    assert.equal(invited.body.staff.email, "cafe-staff@example.com");
    assert.equal(invited.body.staff.staffVenueId, venue._id.toString());
    assert.equal(invited.body.temporaryPassword, "temp-pass-123");
    assert.equal(invited.body.resetSent, false);

    const staffToken = await login(app, "cafe-staff@example.com", "temp-pass-123");
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const pause = await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/pause`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({});
    assert.equal(pause.status, 200);

    const staffInvite = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({
        name: "Other",
        email: "other@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
      });
    assert.equal(staffInvite.status, 403);

    const staffVenue = await request(app)
      .post("/api/admin/venues")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Should not exist" });
    assert.equal(staffVenue.status, 403);
  });

  it("generates a password and mails a reset link when no temporary password is given", async () => {
    const { venue } = await seedVenueAndQueues();
    const app = testApp();
    const admin = await createAdmin(app);
    const sent = [];
    setMailer((payload) => sent.push(payload));

    const invited = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-staff@example.com",
        venueId: venue._id.toString(),
      });
    assert.equal(invited.status, 201);
    assert.equal(invited.body.resetSent, true);
    assert.ok(invited.body.temporaryPassword.length >= 8);
    assert.equal(sent.length, 1);
    assert.match(sent[0].resetUrl, /reset-password\?token=/);
    const staffToken = await login(app, "cafe-staff@example.com", invited.body.temporaryPassword);
    assert.ok(staffToken);
  });

  it("rejects a missing venue, a duplicate email, and does not weaken public register", async () => {
    const { venue } = await seedVenueAndQueues();
    const app = testApp();
    const admin = await createAdmin(app);

    const missing = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Cafe Staff", email: "cafe-staff@example.com" });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /venue/i);

    const unknown = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-staff@example.com",
        venueId: "64b0c0ffee00000000000001",
      });
    assert.equal(unknown.status, 404);

    await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-staff@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
      });
    const duplicate = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Other",
        email: "cafe-staff@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
      });
    assert.equal(duplicate.status, 409);

    const registered = await request(app).post("/api/auth/register").send({
      email: "student@example.com",
      password: "password123",
      name: "Student",
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.role, "user");
    assert.equal(registered.body.user.staffVenueId, null);
  });

  it("rejects a student on the invite route", async () => {
    await seedVenueAndQueues();
    const campus = await Venue.findOne({ slug: "campus-hub" });
    const app = testApp();
    const student = await request(app).post("/api/auth/register").send({
      email: "student@example.com",
      password: "password123",
      name: "Student",
    });
    const refused = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${student.body.token}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-staff@example.com",
        venueId: campus._id.toString(),
        temporaryPassword: "temp-pass-123",
      });
    assert.equal(refused.status, 403);
  });
});
