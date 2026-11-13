import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { setNow, resetClock } from "../src/services/clock.js";
import { pickBusiest } from "../src/services/liveView.js";

const PASSWORD = "password123";
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const NOW = new Date("2026-11-14T15:00:00+05:30");
const minsAgo = (m) => new Date(NOW.getTime() - m * 60_000);

async function login(app, email) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function makeUser(app, email, fields) {
  const user = await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword(PASSWORD), ...fields });
  return { user, token: await login(app, email) };
}

let token = 1;
/** Raw insert so timestamps are exactly what the test says. */
async function entry(queue, fields) {
  const createdAt = fields.createdAt || minsAgo(30);
  await QueueEntry.collection.insertOne({
    queue: queue._id,
    isWalkIn: true,
    walkInName: `Walk-in ${token}`,
    tokenNumber: token++,
    status: "waiting",
    calledAt: null,
    servedAt: null,
    skippedAt: null,
    noShowAt: null,
    servingCounterId: null,
    ...fields,
    createdAt,
    updatedAt: fields.updatedAt || fields.servedAt || fields.skippedAt || fields.noShowAt || createdAt,
  });
}

describe("live staff view", () => {
  let app;
  let global;
  let cafe;
  let gym;
  let counterA;
  let counterB;
  let annexQueue;
  let annexOrg;

  before(async () => {
    await setupTestDb();
    app = testApp();
  });
  after(async () => {
    resetClock();
    await teardownTestDb();
  });
  afterEach(() => resetClock());

  beforeEach(async () => {
    resetClock();
    await resetDb();
    await seedVenueAndQueues();
    cafe = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    counterA = new mongoose.Types.ObjectId();
    counterB = new mongoose.Types.ObjectId();
    await Queue.updateOne(
      { _id: cafe._id },
      {
        $set: {
          nowServing: 12,
          counters: [
            { _id: counterA, name: "Counter A", nowServing: 12, state: "open" },
            { _id: counterB, name: "Counter B", nowServing: null, state: "break" },
          ],
        },
      }
    );
    cafe = await Queue.findById(cafe._id);
    global = await makeUser(app, "global@example.com", { role: "admin" });

    const org = await request(app).post("/api/admin/organizations").set(auth(global.token)).send({ name: "City Annex" });
    const venue = await request(app)
      .post("/api/admin/venues")
      .set(auth(global.token))
      .send({ name: "Outpatient Block", organizationId: org.body.organization.id });
    const queue = await request(app).post("/api/admin/queues").set(auth(global.token)).send({ venueId: venue.body.venue.id, name: "Pharmacy" });
    assert.equal(queue.status, 201);
    annexQueue = await Queue.findById(queue.body.queue.id);
    annexOrg = org.body.organization;

    setNow(NOW);
    // Cafeteria today: 3 served at A (one in the last hour), 1 at B (in the last hour), waits 10/20/30/40 min to the call.
    await entry(cafe, { status: "served", servingCounterId: counterA, createdAt: minsAgo(200), calledAt: minsAgo(190), servedAt: minsAgo(185) });
    await entry(cafe, { status: "served", servingCounterId: counterA, createdAt: minsAgo(150), calledAt: minsAgo(130), servedAt: minsAgo(125) });
    await entry(cafe, { status: "served", servingCounterId: counterA, createdAt: minsAgo(60), calledAt: minsAgo(30), servedAt: minsAgo(20) });
    await entry(cafe, { status: "served", servingCounterId: counterB, createdAt: minsAgo(100), calledAt: minsAgo(60), servedAt: minsAgo(55) });
    // Yesterday (campus day) does not count.
    const yesterday = new Date("2026-11-13T18:00:00+05:30");
    await entry(cafe, { status: "served", servingCounterId: counterB, createdAt: yesterday, calledAt: yesterday, servedAt: yesterday });
    // Live line.
    await entry(cafe, { status: "waiting" });
    await entry(cafe, { status: "waiting" });
    await entry(gym, { status: "waiting" });
    // No-shows: one stamped, one legacy; a staff skip and yesterday's no-show do not count.
    await entry(cafe, { status: "skipped", skipReason: "no-show", calledAt: minsAgo(50), skippedAt: minsAgo(40), noShowAt: minsAgo(40), noShows: 1 });
    await entry(gym, { status: "skipped", calledAt: minsAgo(50), skippedAt: minsAgo(45) });
    await entry(cafe, { status: "skipped", skipReason: "staff", calledAt: minsAgo(50), skippedAt: minsAgo(45) });
    await entry(cafe, { status: "skipped", skipReason: "no-show", calledAt: yesterday, skippedAt: yesterday, noShowAt: yesterday });
    // Another organization's queue.
    await entry(annexQueue, { status: "served", servingCounterId: annexQueue.counters[0]._id, createdAt: minsAgo(30), calledAt: minsAgo(25), servedAt: minsAgo(20) });
    await entry(annexQueue, { status: "waiting" });
  });

  it("rolls up today's served, waits, waiting, no-shows, counters and the busiest counter", async () => {
    const res = await request(app).get("/api/admin/live").set(auth(global.token));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body.refreshSeconds, 15);
    assert.equal(res.body.generatedAt, NOW.toISOString());
    assert.equal(res.body.day.from, "2026-11-13T18:30:00.000Z");

    const t = res.body.totals;
    assert.equal(t.servedToday, 5);
    assert.equal(t.servedLastHour, 3); // A at -20m, B at -55m, annex at -20m
    assert.equal(t.waitingCount, 4);
    assert.equal(t.noShowsToday, 2);
    assert.equal(t.averageWaitMinutes, 21); // (10+20+30+40+5)/5
    assert.equal(t.totalCounters, 4);
    assert.equal(t.openCounters, 3);

    assert.deepEqual(
      { queueName: res.body.busiestCounter.queueName, name: res.body.busiestCounter.name, servedToday: res.body.busiestCounter.servedToday },
      { queueName: "Cafeteria", name: "Counter A", servedToday: 3 }
    );

    const cafeRow = res.body.queues.find((q) => q.name === "Cafeteria");
    assert.equal(cafeRow.servedToday, 4);
    assert.equal(cafeRow.waitingCount, 2);
    assert.equal(cafeRow.noShowsToday, 1);
    assert.equal(cafeRow.averageWaitMinutes, 25);
    assert.equal(cafeRow.nowServing, 12);
    assert.equal(cafeRow.openCounters, 1);
    assert.equal(cafeRow.totalCounters, 2);
    assert.equal(cafeRow.busiestCounter.name, "Counter A");
    assert.deepEqual(
      cafeRow.counters.map((c) => [c.name, c.state, c.servedToday, c.servedLastHour, c.nowServing]),
      [
        ["Counter A", "open", 3, 1, 12],
        ["Counter B", "break", 1, 1, null],
      ]
    );
    const gymRow = res.body.queues.find((q) => q.name === "Gym");
    assert.equal(gymRow.noShowsToday, 1);
    assert.equal(gymRow.servedToday, 0);
    assert.equal(gymRow.averageWaitMinutes, null);
    assert.equal(gymRow.busiestCounter, null);
  });

  it("filters to one queue or one venue", async () => {
    const one = await request(app).get(`/api/admin/live?queueId=${gym._id}`).set(auth(global.token));
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.queues.map((q) => q.name), ["Gym"]);
    assert.equal(one.body.totals.waitingCount, 1);

    const venue = await request(app).get(`/api/admin/live?venueId=${cafe.venue}`).set(auth(global.token));
    assert.deepEqual(venue.body.queues.map((q) => q.name).sort(), ["Cafeteria", "Gym"]);
    assert.equal(venue.body.venue.id, String(cafe.venue));

    assert.equal((await request(app).get("/api/admin/live?queueId=nope").set(auth(global.token))).status, 404);
    assert.equal((await request(app).get(`/api/admin/live?queueId=${new mongoose.Types.ObjectId()}`).set(auth(global.token))).status, 404);
    await Queue.updateOne({ _id: gym._id }, { $set: { archivedAt: NOW } });
    assert.equal((await request(app).get(`/api/admin/live?queueId=${gym._id}`).set(auth(global.token))).status, 404);
  });

  it("org admins only see their organizations' queues; other orgs are 404/403", async () => {
    const orgAdmin = await makeUser(app, "annex-admin@example.com", { role: "admin", adminOrganizations: [annexOrg.id] });
    const res = await request(app).get("/api/admin/live").set(auth(orgAdmin.token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.queues.map((q) => q.name), ["Pharmacy"]);
    assert.equal(res.body.totals.servedToday, 1);
    assert.equal(res.body.totals.waitingCount, 1);
    assert.equal(res.body.totals.noShowsToday, 0);
    assert.equal(res.body.busiestCounter.queueName, "Pharmacy");

    const cross = await request(app).get(`/api/admin/live?queueId=${cafe._id}`).set(auth(orgAdmin.token));
    assert.equal(cross.status, 404);
    assert.equal(JSON.stringify(cross.body).includes("Cafeteria"), false);
    const crossVenue = await request(app).get(`/api/admin/live?venueId=${cafe.venue}`).set(auth(orgAdmin.token));
    assert.equal(crossVenue.status, 403);

    // A global admin scoped to the default org sees the main campus and not the annex.
    const mainAdmin = await makeUser(app, "main-admin@example.com", { role: "admin", adminOrganizations: ["default"] });
    const main = await request(app).get("/api/admin/live").set(auth(mainAdmin.token));
    assert.deepEqual(main.body.queues.map((q) => q.name).sort(), ["Cafeteria", "Gym"]);
    assert.equal((await request(app).get(`/api/admin/live?queueId=${annexQueue._id}`).set(auth(mainAdmin.token))).status, 404);
  });

  it("staff see only their venue and allowed queues", async () => {
    const staff = await makeUser(app, "riya@example.com", { role: "staff", staffVenue: cafe.venue, staffQueues: [cafe._id] });
    const res = await request(app).get("/api/admin/live").set(auth(staff.token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.queues.map((q) => q.name), ["Cafeteria"]);
    assert.equal(res.body.totals.servedToday, 4);
    assert.equal((await request(app).get(`/api/admin/live?queueId=${gym._id}`).set(auth(staff.token))).status, 404);
    assert.equal((await request(app).get(`/api/admin/live?queueId=${annexQueue._id}`).set(auth(staff.token))).status, 404);

    const venueStaff = await makeUser(app, "arjun@example.com", { role: "staff", staffVenue: cafe.venue });
    const all = await request(app).get("/api/admin/live").set(auth(venueStaff.token));
    assert.deepEqual(all.body.queues.map((q) => q.name).sort(), ["Cafeteria", "Gym"]);
  });

  it("students get 403, anonymous 401, and reading changes nothing", async () => {
    assert.equal((await request(app).get("/api/admin/live")).status, 401);
    const student = await makeUser(app, "student@example.com", {});
    assert.equal((await request(app).get("/api/admin/live").set(auth(student.token))).status, 403);

    const before = {
      entries: JSON.stringify(await QueueEntry.find().sort({ _id: 1 }).lean()),
      queues: JSON.stringify(await Queue.find().sort({ _id: 1 }).lean()),
      audits: await AdminAudit.countDocuments(),
    };
    await request(app).get("/api/admin/live").set(auth(global.token));
    await request(app).get(`/api/admin/live?queueId=${cafe._id}`).set(auth(global.token));
    assert.equal(JSON.stringify(await QueueEntry.find().sort({ _id: 1 }).lean()), before.entries);
    assert.equal(JSON.stringify(await Queue.find().sort({ _id: 1 }).lean()), before.queues);
    assert.equal(await AdminAudit.countDocuments(), before.audits);
  });

  it("an empty scope returns zeros, and busiest-counter ties are stable", async () => {
    await Queue.updateMany({}, { $set: { archivedAt: NOW } });
    const res = await request(app).get("/api/admin/live").set(auth(global.token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.queues, []);
    assert.equal(res.body.totals.servedToday, 0);
    assert.equal(res.body.totals.averageWaitMinutes, null);
    assert.equal(res.body.busiestCounter, null);

    assert.equal(pickBusiest([]), null);
    assert.equal(pickBusiest([{ name: "A", servedToday: 0, servedLastHour: 0 }]), null);
    assert.equal(pickBusiest([
      { name: "B", servedToday: 3, servedLastHour: 1 },
      { name: "A", servedToday: 3, servedLastHour: 1 },
      { name: "C", servedToday: 3, servedLastHour: 0 },
    ]).name, "A");
    assert.equal(pickBusiest([
      { name: "B", servedToday: 3, servedLastHour: 2 },
      { name: "A", servedToday: 3, servedLastHour: 1 },
    ]).name, "B");
  });
});
