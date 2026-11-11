import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { QueueEntry } from "../src/models/QueueEntry.js";

async function login(app, email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function createServedEntry(queueId, waitMinutes) {
  const servedAt = new Date("2026-08-10T12:00:00+05:30");
  const joinedAt = new Date(servedAt.getTime() - waitMinutes * 60_000);
  const entry = await QueueEntry.create({
    queue: queueId,
    user: (
      await User.create({
        email: `camp-an-${Math.random().toString(36).slice(2, 10)}@example.com`,
        name: "Campus Student",
        passwordHash: await User.hashPassword("password123"),
      })
    )._id,
    tokenNumber: Math.floor(Math.random() * 100_000) + 1,
    status: "served",
  });
  await QueueEntry.collection.updateOne(
    { _id: entry._id },
    { $set: { createdAt: joinedAt, updatedAt: servedAt } }
  );
}

describe("Campus analytics + CSV export", () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("rolls up every venue for a global admin and exports CSV for the window", async () => {
    const { venue: campus } = await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });
    await createServedEntry(cafeteria._id, 4);
    await createServedEntry(cafeteria._id, 6);
    await createServedEntry(gym._id, 8);

    await User.create({
      email: "admin@example.com",
      name: "Admin",
      passwordHash: await User.hashPassword("password123"),
      role: "admin",
    });
    const app = testApp();
    const admin = await login(app, "admin@example.com", "password123");

    const json = await request(app)
      .get("/api/admin/analytics?window=all")
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(json.status, 200);
    assert.equal(json.body.metrics.servedCount, 3);
    assert.equal(json.body.metrics.averageWaitMinutes, 6);
    assert.equal(json.body.metrics.longestWaitMinutes, 8);
    assert.equal(json.body.venue, null);
    const cafeteriaRow = json.body.queues.find((row) => row.id === cafeteria._id.toString());
    const gymRow = json.body.queues.find((row) => row.id === gym._id.toString());
    assert.equal(cafeteriaRow.servedCount, 2);
    assert.equal(gymRow.servedCount, 1);

    const csv = await request(app)
      .get("/api/admin/analytics.csv?window=all")
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers["content-type"], /text\/csv/);
    assert.match(csv.headers["content-disposition"], /queueit-analytics-all\.csv/);
    const body = String(csv.text);
    assert.match(body, /^queue,venue,served,skipped,left,waiting_now,average_wait_minutes,longest_wait_minutes/);
    assert.match(body, /Cafeteria,/);
    assert.match(body, /Gym,/);
    assert.match(body, /Totals,/);
    assert.doesNotMatch(body, /Campus Student/);
    assert.doesNotMatch(body, /@example.com/);

    const scoped = await request(app)
      .get(`/api/admin/analytics?window=all&venueId=${campus._id.toString()}`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.venue.id, campus._id.toString());
    assert.equal(scoped.body.metrics.servedCount, 3);
  });

  it("lets staff see only their venue and 403s another venue", async () => {
    const { venue: campus } = await seedVenueAndQueues();
    const library = await Venue.create({ name: "Library Annex", slug: "library-annex" });
    const holds = await Queue.create({
      name: "Holds desk",
      slug: "holds-desk",
      venue: library._id,
      averageServiceTime: 4,
      status: "open",
      acceptingTokens: true,
      counters: [{ name: "Counter 1", nowServing: null }],
    });
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    await createServedEntry(cafeteria._id, 5);
    await createServedEntry(holds._id, 20);

    await User.create({
      email: "cafeteria-staff@example.com",
      name: "Cafe Staff",
      passwordHash: await User.hashPassword("password123"),
      role: "staff",
      staffVenue: campus._id,
    });
    const app = testApp();
    const staff = await login(app, "cafeteria-staff@example.com", "password123");

    const json = await request(app)
      .get("/api/admin/analytics?window=all")
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(json.status, 200);
    assert.equal(json.body.venue.id, campus._id.toString());
    assert.equal(json.body.metrics.servedCount, 1);
    assert.ok(json.body.queues.every((row) => row.venue === "Campus Hub"));
    assert.ok(!json.body.queues.some((row) => row.name === "Holds desk"));

    const forbidden = await request(app)
      .get(`/api/admin/analytics?window=all&venueId=${library._id.toString()}`)
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(forbidden.status, 403);

    const csv = await request(app)
      .get(`/api/admin/analytics.csv?window=all&venueId=${library._id.toString()}`)
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(csv.status, 403);
  });
});
