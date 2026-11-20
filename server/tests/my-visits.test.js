import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { Feedback } from "../src/models/Feedback.js";
import { User } from "../src/models/User.js";
import { parseVisitQuery, visitOutcome, visitWaitMinutes } from "../src/services/visitHistory.js";

const MIN = 60_000;

async function register(app, email, name = "Student") {
  const res = await request(app).post("/api/auth/register").send({ email, password: "password123", name });
  assert.equal(res.status, 201);
  return { token: res.body.token, id: res.body.user.id };
}

let token = 0;
/** Insert finished tickets with explicit times, as older rows exist in production. */
async function addVisit(userId, queueId, { status = "served", joined, waitMin = null, skipReason = null, serveMin = 3 } = {}) {
  token += 1;
  const createdAt = new Date(joined);
  const calledAt = waitMin == null ? null : new Date(createdAt.getTime() + waitMin * MIN);
  const doc = {
    queue: new mongoose.Types.ObjectId(String(queueId)),
    user: new mongoose.Types.ObjectId(String(userId)),
    guest: null,
    isWalkIn: false,
    tokenNumber: token,
    waitOrder: token * 1000,
    status,
    calledAt,
    servedAt: status === "served" && calledAt ? new Date(calledAt.getTime() + serveMin * MIN) : null,
    skippedAt: status === "skipped" && calledAt ? new Date(calledAt.getTime() + 5 * MIN) : null,
    skipReason,
    createdAt,
    updatedAt: createdAt,
  };
  const { insertedId } = await QueueEntry.collection.insertOne(doc);
  return insertedId;
}

describe("My visits + starred queues (/api/me)", () => {
  let app;
  let cafeteria;
  let gym;

  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    app = testApp();
    await seedVenueAndQueues();
    cafeteria = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    token = 0;
  });

  it("needs a signed-in account (guests and anonymous get 401)", async () => {
    assert.equal((await request(app).get("/api/me/visits")).status, 401);
    assert.equal((await request(app).get("/api/me/favorites")).status, 401);
    assert.equal((await request(app).put(`/api/me/favorites/${gym._id}`)).status, 401);
  });

  it("returns an empty, no-store page for a new account", async () => {
    const ana = await register(app, "ana@example.com");
    const res = await request(app).get("/api/me/visits").set("Authorization", `Bearer ${ana.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.body.visits, []);
    assert.equal(res.body.total, 0);
    assert.equal(res.body.totalPages, 1);
    assert.equal(res.body.summary.totalVisits, 0);
    assert.equal(res.body.summary.averageWaitMinutes, null);
    assert.deepEqual(res.body.summary.topQueues, []);
  });

  it("lists only my tickets with wait, outcome and feedback, newest first", async () => {
    const ana = await register(app, "ana@example.com");
    const ben = await register(app, "ben@example.com");
    const served = await addVisit(ana.id, cafeteria._id, { joined: "2026-11-10T05:00:00Z", waitMin: 12 });
    await addVisit(ana.id, gym._id, { status: "skipped", joined: "2026-11-11T05:00:00Z", waitMin: 4, skipReason: "no-show" });
    await addVisit(ana.id, gym._id, { status: "skipped", joined: "2026-11-12T05:00:00Z", waitMin: 6 }); // legacy, no reason
    await addVisit(ana.id, cafeteria._id, { status: "skipped", joined: "2026-11-13T05:00:00Z", waitMin: 2, skipReason: "staff" });
    await addVisit(ana.id, cafeteria._id, { status: "left", joined: "2026-11-14T05:00:00Z" });
    await addVisit(ben.id, cafeteria._id, { joined: "2026-11-15T05:00:00Z", waitMin: 99 });
    await Feedback.create({ queue: cafeteria._id, entry: served, user: ana.id, rating: 4, comment: "Quick" });

    const res = await request(app).get("/api/me/visits").set("Authorization", `Bearer ${ana.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 5);
    assert.deepEqual(
      res.body.visits.map((v) => v.outcome),
      ["left", "skipped", "no-show", "no-show", "served"]
    );
    const last = res.body.visits.at(-1);
    assert.equal(last.queue.name, "Cafeteria");
    assert.equal(last.waitMinutes, 12);
    assert.deepEqual(last.feedback, { rating: 4, comment: "Quick" });
    assert.equal(res.body.visits[0].waitMinutes, null);
    assert.equal(res.body.visits[0].feedback, null);
    assert.ok(res.body.visits.every((v) => v.waitMinutes !== 99));

    const s = res.body.summary;
    assert.equal(s.totalVisits, 5);
    assert.equal(s.served, 1);
    assert.equal(s.noShows, 2);
    assert.equal(s.left, 1);
    assert.equal(s.averageWaitMinutes, 12);
    assert.deepEqual(s.topQueues.map((q) => [q.name, q.visits]), [["Cafeteria", 3], ["Gym", 2]]);
    assert.deepEqual(res.body.queues.map((q) => q.name), ["Cafeteria", "Gym"]);
  });

  it("filters by queue and by campus (IST) day range, with stats for the filter", async () => {
    const ana = await register(app, "ana@example.com");
    // 2026-11-19T19:00Z is 00:30 on 20 Nov in IST; 18:00Z is 23:30 on 19 Nov.
    await addVisit(ana.id, cafeteria._id, { joined: "2026-11-19T18:00:00Z", waitMin: 10 });
    await addVisit(ana.id, cafeteria._id, { joined: "2026-11-19T19:00:00Z", waitMin: 20 });
    await addVisit(ana.id, gym._id, { joined: "2026-11-20T10:00:00Z", waitMin: 30 });
    await addVisit(ana.id, gym._id, { joined: "2026-11-20T19:00:00Z", waitMin: 40 }); // 21 Nov IST

    const auth = { Authorization: `Bearer ${ana.token}` };
    const day = await request(app).get("/api/me/visits?from=2026-11-20&to=2026-11-20").set(auth);
    assert.equal(day.status, 200);
    assert.equal(day.body.total, 2);
    assert.equal(day.body.summary.averageWaitMinutes, 25);
    assert.deepEqual(day.body.filters, { queue: null, from: "2026-11-20", to: "2026-11-20" });

    const gymOnly = await request(app).get(`/api/me/visits?queue=${gym._id}`).set(auth);
    assert.equal(gymOnly.body.total, 2);
    assert.ok(gymOnly.body.visits.every((v) => v.queue.name === "Gym"));
    assert.equal(gymOnly.body.queues.length, 2, "queue picker still lists every visited queue");

    const both = await request(app).get(`/api/me/visits?queue=${cafeteria._id}&from=2026-11-20`).set(auth);
    assert.equal(both.body.total, 1);
    assert.equal(both.body.visits[0].waitMinutes, 20);
  });

  it("paginates with page and pageSize", async () => {
    const ana = await register(app, "ana@example.com");
    for (let i = 1; i <= 5; i += 1) {
      await addVisit(ana.id, cafeteria._id, { joined: `2026-11-0${i}T05:00:00Z`, waitMin: i });
    }
    const auth = { Authorization: `Bearer ${ana.token}` };
    const p1 = await request(app).get("/api/me/visits?pageSize=2").set(auth);
    assert.equal(p1.body.totalPages, 3);
    assert.deepEqual(p1.body.visits.map((v) => v.waitMinutes), [5, 4]);
    const p3 = await request(app).get("/api/me/visits?pageSize=2&page=3").set(auth);
    assert.deepEqual(p3.body.visits.map((v) => v.waitMinutes), [1]);
    assert.equal(p3.body.summary.totalVisits, 5, "stats cover the whole filter, not one page");
    const capped = await request(app).get("/api/me/visits?pageSize=500").set(auth);
    assert.equal(capped.body.pageSize, 50);
  });

  it("rejects bad filters", async () => {
    const ana = await register(app, "ana@example.com");
    const auth = { Authorization: `Bearer ${ana.token}` };
    for (const qs of ["page=0", "page=abc", "pageSize=-1", "queue=nope", "from=20-11-2026", "to=2026-02-30", "from=2026-11-20&to=2026-11-19"]) {
      const res = await request(app).get(`/api/me/visits?${qs}`).set(auth);
      assert.equal(res.status, 400, qs);
    }
  });

  it("covers a real join-and-leave through the API", async () => {
    const ana = await register(app, "ana@example.com");
    const auth = { Authorization: `Bearer ${ana.token}` };
    assert.equal((await request(app).post(`/api/queues/${cafeteria._id}/join`).set(auth)).status, 201);
    let res = await request(app).get("/api/me/visits").set(auth);
    assert.equal(res.body.visits[0].outcome, "active");
    assert.equal(res.body.summary.active, 1);
    assert.equal((await request(app).post(`/api/queues/${cafeteria._id}/leave`).set(auth)).status, 200);
    res = await request(app).get("/api/me/visits").set(auth);
    assert.equal(res.body.visits[0].outcome, "left");
    assert.equal(res.body.visits[0].waitMinutes, null);
  });

  it("stars and unstars queues, idempotently and per account", async () => {
    const ana = await register(app, "ana@example.com");
    const ben = await register(app, "ben@example.com");
    const auth = { Authorization: `Bearer ${ana.token}` };
    let res = await request(app).put(`/api/me/favorites/${gym._id}`).set(auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.favorites, [String(gym._id)]);
    res = await request(app).put(`/api/me/favorites/${gym._id}`).set(auth);
    assert.deepEqual(res.body.favorites, [String(gym._id)]);
    res = await request(app).put(`/api/me/favorites/${cafeteria._id}`).set(auth);
    assert.deepEqual(res.body.favorites, [String(gym._id), String(cafeteria._id)]);

    const benFav = await request(app).get("/api/me/favorites").set("Authorization", `Bearer ${ben.token}`);
    assert.deepEqual(benFav.body.favorites, []);

    res = await request(app).delete(`/api/me/favorites/${gym._id}`).set(auth);
    assert.deepEqual(res.body.favorites, [String(cafeteria._id)]);
    res = await request(app).delete(`/api/me/favorites/${gym._id}`).set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("validates the queue and drops stars for removed queues", async () => {
    const ana = await register(app, "ana@example.com");
    const auth = { Authorization: `Bearer ${ana.token}` };
    assert.equal((await request(app).put("/api/me/favorites/not-an-id").set(auth)).status, 400);
    assert.equal((await request(app).put(`/api/me/favorites/${new mongoose.Types.ObjectId()}`).set(auth)).status, 404);
    await request(app).put(`/api/me/favorites/${gym._id}`).set(auth);
    await Queue.deleteOne({ _id: gym._id });
    const res = await request(app).get("/api/me/favorites").set(auth);
    assert.deepEqual(res.body.favorites, []);
  });

  it("works for accounts created before stars existed and caps at 20", async () => {
    const ana = await register(app, "ana@example.com");
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(ana.id) }, { $unset: { favoriteQueues: "" } });
    const auth = { Authorization: `Bearer ${ana.token}` };
    assert.deepEqual((await request(app).get("/api/me/favorites").set(auth)).body.favorites, []);

    const base = cafeteria.toObject();
    delete base._id;
    const extra = [];
    for (let i = 0; i < 20; i += 1) {
      const q = await Queue.create({ ...base, name: `Desk ${i}`, slug: `desk-${i}`, counters: [] });
      extra.push(q._id);
    }
    await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(ana.id) }, { $set: { favoriteQueues: extra } });
    const res = await request(app).put(`/api/me/favorites/${gym._id}`).set(auth);
    assert.equal(res.status, 409);
  });
});

describe("visit helpers", () => {
  it("maps outcomes including legacy skips", () => {
    assert.equal(visitOutcome({ status: "waiting" }), "active");
    assert.equal(visitOutcome({ status: "skipped", skipReason: null }), "no-show");
    assert.equal(visitOutcome({ status: "skipped", skipReason: "staff" }), "skipped");
  });
  it("computes wait from join to call, falling back to served time", () => {
    const createdAt = new Date("2026-11-20T05:00:00Z");
    assert.equal(visitWaitMinutes({ createdAt, calledAt: new Date(createdAt.getTime() + 7 * MIN) }), 7);
    assert.equal(visitWaitMinutes({ createdAt, servedAt: new Date(createdAt.getTime() + 9 * MIN) }), 9);
    assert.equal(visitWaitMinutes({ createdAt }), null);
    assert.equal(visitWaitMinutes({ createdAt, calledAt: new Date(createdAt.getTime() - MIN) }), null);
  });
  it("parses campus days inclusively", () => {
    const r = parseVisitQuery({ from: "2026-11-20", to: "2026-11-20" });
    assert.equal(r.ok, true);
    assert.equal(r.value.from.toISOString(), "2026-11-19T18:30:00.000Z");
    assert.equal(r.value.to.toISOString(), "2026-11-20T18:30:00.000Z");
  });
});
