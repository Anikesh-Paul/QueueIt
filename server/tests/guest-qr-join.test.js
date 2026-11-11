import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { Guest } from "../src/models/Guest.js";
import { User } from "../src/models/User.js";
import { Venue } from "../src/models/Venue.js";
import { trustProxySetting } from "../src/app.js";
import {
  DEFAULT_GUEST_MINTS_PER_HOUR,
  GUEST_MAX_ACTIVE_PLACES,
  guestMintsPerHour,
  networkHashOf,
} from "../src/services/guestLimits.js";

const GUEST = "X-Guest-Credential";

async function adminToken(app) {
  await User.create({ email: "a@example.com", name: "Admin", role: "admin", passwordHash: await User.hashPassword("password123") });
  const res = await request(app).post("/api/auth/login").send({ email: "a@example.com", password: "password123" });
  return res.body.token;
}

async function extraQueue(venueId, name) {
  return Queue.create({ venue: venueId, name, slug: name.toLowerCase().replace(/\s+/g, "-"), averageServiceTime: 3 });
}

describe("QR scan-to-join as guest + abuse limits", () => {
  let app;
  let cafeteria;
  let gym;
  let venue;

  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    ({ venue } = await seedVenueAndQueues());
    cafeteria = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    app = testApp();
  });
  afterEach(() => {
    delete process.env.GUEST_MINTS_PER_HOUR;
  });

  it("joins from a poster QR without login and records the source", async () => {
    const res = await request(app).post(`/api/queues/${cafeteria._id}/join`).send({ source: "qr" });
    assert.equal(res.status, 201);
    assert.equal(res.body.guestCredentialMinted, true);
    const entry = await QueueEntry.findOne({ queue: cafeteria._id });
    assert.equal(entry.joinSource, "qr");
    assert.ok(entry.guest);
    const guest = await Guest.findById(entry.guest);
    assert.match(guest.networkHash, /^[a-f0-9]{64}$/);

    const other = await request(app).post(`/api/queues/${gym._id}/join`).send({ source: "bogus" });
    assert.equal(other.status, 201);
    const otherEntry = await QueueEntry.findOne({ queue: gym._id });
    assert.equal(otherEntry.joinSource, "app");
  });

  it("still enforces the waiting cap and the closed gate for QR guests", async () => {
    cafeteria.maxWaiting = 1;
    await cafeteria.save();
    const first = await request(app).post(`/api/queues/${cafeteria._id}/join`).send({ source: "qr" });
    assert.equal(first.status, 201);
    const second = await request(app).post(`/api/queues/${cafeteria._id}/join`).send({ source: "qr" });
    assert.equal(second.status, 409);
    assert.match(second.body.error, /full/i);

    gym.acceptingTokens = false;
    await gym.save();
    const closed = await request(app).post(`/api/queues/${gym._id}/join`).send({ source: "qr" });
    assert.equal(closed.status, 409);
    assert.match(closed.body.error, /closed/i);
  });

  it("lets a QR guest ask for the priority lane", async () => {
    const join = await request(app).post(`/api/queues/${cafeteria._id}/join`).send({ source: "qr" });
    const res = await request(app)
      .post(`/api/queues/${cafeteria._id}/priority-request`)
      .set(GUEST, join.body.guestCredential)
      .send({ reason: "accessibility" });
    assert.equal(res.status, 200, res.body.error);
    assert.equal(res.body.priorityRequestStatus, "pending");
  });

  it("refuses guests when the queue has guest joining switched off, but not signed-in users", async () => {
    const admin = await adminToken(app);
    const patch = await request(app)
      .patch(`/api/admin/queues/${cafeteria._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ guestJoin: false });
    assert.equal(patch.status, 200, patch.body.error);
    assert.equal(patch.body.queue.guestJoin, false);

    const bad = await request(app)
      .patch(`/api/admin/queues/${cafeteria._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ guestJoin: "nope" });
    assert.equal(bad.status, 400);

    const guest = await request(app).post(`/api/queues/${cafeteria._id}/join`).send({ source: "qr" });
    assert.equal(guest.status, 403);
    assert.equal(guest.body.code, "guest-join-disabled");
    assert.equal(await Guest.countDocuments(), 0, "no pass minted for a refused join");

    const reg = await request(app).post("/api/auth/register").send({ email: "u@example.com", password: "password123", name: "U" });
    const user = await request(app).post(`/api/queues/${cafeteria._id}/join`).set("Authorization", `Bearer ${reg.body.token}`);
    assert.equal(user.status, 201);

    const board = await request(app).get(`/api/queues/${cafeteria._id}/board`);
    assert.equal(board.status, 200);
    assert.equal(board.body.queue.guestJoin, false);
    const catalog = await request(app).get("/api/queues");
    assert.equal(catalog.body.queues.find((q) => q.id === String(cafeteria._id)).guestJoin, false);
    assert.equal(catalog.body.queues.find((q) => q.id === String(gym._id)).guestJoin, true);
  });

  it(`caps a guest pass at ${GUEST_MAX_ACTIVE_PLACES} active places`, async () => {
    const third = await extraQueue(venue._id, "Library Desk");
    const first = await request(app).post(`/api/queues/${cafeteria._id}/join`);
    const cred = first.body.guestCredential;
    const second = await request(app).post(`/api/queues/${gym._id}/join`).set(GUEST, cred);
    assert.equal(second.status, 201);
    const blocked = await request(app).post(`/api/queues/${third._id}/join`).set(GUEST, cred);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, "guest-active-limit");
    // Already-in-line still gets the friendly 409, not the limit.
    const again = await request(app).post(`/api/queues/${gym._id}/join`).set(GUEST, cred);
    assert.equal(again.status, 409);
    // Leaving one frees a slot.
    await request(app).post(`/api/queues/${gym._id}/leave`).set(GUEST, cred);
    const ok = await request(app).post(`/api/queues/${third._id}/join`).set(GUEST, cred);
    assert.equal(ok.status, 201);
  });

  it("pauses guest joining after repeated no-shows", async () => {
    const first = await request(app).post(`/api/queues/${cafeteria._id}/join`);
    const cred = first.body.guestCredential;
    const guest = await Guest.findOne();
    await QueueEntry.updateMany({ guest: guest._id }, { $set: { status: "skipped", skippedAt: new Date(), recoveryCount: 1 } });
    await QueueEntry.collection.insertOne({
      queue: gym._id,
      guest: guest._id,
      user: null,
      isWalkIn: false,
      tokenNumber: 900,
      waitOrder: 900000,
      status: "skipped",
      recoveryCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      skippedAt: new Date(),
    });
    const third = await extraQueue(venue._id, "Library Desk");
    const res = await request(app).post(`/api/queues/${third._id}/join`).set(GUEST, cred);
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "guest-no-show-cooldown");
  });

  it("caps new guest passes per network per hour", async () => {
    process.env.GUEST_MINTS_PER_HOUR = "2";
    const a = await request(app).post(`/api/queues/${cafeteria._id}/join`);
    const b = await request(app).post(`/api/queues/${gym._id}/join`);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const third = await extraQueue(venue._id, "Library Desk");
    const c = await request(app).post(`/api/queues/${third._id}/join`);
    assert.equal(c.status, 429);
    assert.equal(c.body.code, "guest-mint-limit");
    // An existing pass is not affected by the mint cap.
    const reuse = await request(app).post(`/api/queues/${third._id}/join`).set(GUEST, a.body.guestCredential);
    assert.equal(reuse.status, 201);
  });

  it("parses limit config and hashes networks safely", () => {
    assert.equal(guestMintsPerHour({}), DEFAULT_GUEST_MINTS_PER_HOUR);
    assert.equal(guestMintsPerHour({ GUEST_MINTS_PER_HOUR: "abc" }), DEFAULT_GUEST_MINTS_PER_HOUR);
    assert.equal(guestMintsPerHour({ GUEST_MINTS_PER_HOUR: "0" }), DEFAULT_GUEST_MINTS_PER_HOUR);
    assert.equal(guestMintsPerHour({ GUEST_MINTS_PER_HOUR: "25" }), 25);
    assert.equal(networkHashOf(""), null);
    assert.notEqual(networkHashOf("10.0.0.1"), networkHashOf("10.0.0.2"));
    assert.ok(!networkHashOf("10.0.0.1").includes("10.0.0.1"));
  });

  it("trusts one proxy hop on Vercel only", () => {
    assert.equal(trustProxySetting({}), false);
    assert.equal(trustProxySetting({ VERCEL: "1" }), 1);
    assert.equal(trustProxySetting({ VERCEL: "1", TRUST_PROXY: "0" }), false);
    assert.equal(trustProxySetting({ TRUST_PROXY: "true" }), 1);
  });

  it("keeps venues isolated (sanity: Venue model loads)", async () => {
    assert.ok(await Venue.findById(venue._id));
  });
});
