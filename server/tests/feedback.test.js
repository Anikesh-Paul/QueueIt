import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock } from "../src/services/clock.js";

async function register(app, email) {
  const res = await request(app).post("/api/auth/register").send({ email, password: "password123", name: email.split("@")[0] });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function adminToken(app) {
  await User.create({ email: "admin@example.com", name: "Admin", passwordHash: await User.hashPassword("password123"), role: "admin" });
  const res = await request(app).post("/api/auth/login").send({ email: "admin@example.com", password: "password123" });
  return res.body.token;
}

async function joinAndServe(app, queueId, token, admin) {
  const join = await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${token}`);
  assert.equal(join.status, 201);
  const serve = await request(app).post(`/api/admin/queues/${queueId}/serve`).set("Authorization", `Bearer ${admin}`);
  assert.equal(serve.status, 200);
  const entry = await QueueEntry.findOne({ queue: queueId, tokenNumber: join.body.tokenNumber });
  return entry._id.toString();
}

describe("feedback after service", () => {
  let app;
  let queueId;
  let admin;
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    resetClock();
    await teardownTestDb();
  });
  beforeEach(async () => {
    resetClock();
    await resetDb();
    app = testApp();
    await seedVenueAndQueues();
    queueId = (await Queue.findOne({ slug: "cafeteria" }))._id.toString();
    admin = await adminToken(app);
  });

  it("lists a served ticket as pending, takes one rating, then stops asking", async () => {
    const token = await register(app, "riya@example.com");
    const entryId = await joinAndServe(app, queueId, token, admin);

    const pending = await request(app).get("/api/queues/feedback/pending").set("Authorization", `Bearer ${token}`);
    assert.equal(pending.status, 200);
    assert.equal(pending.body.pending.length, 1);
    assert.equal(pending.body.pending[0].entryId, entryId);
    assert.equal(pending.body.pending[0].queue.name, "Cafeteria");

    const sent = await request(app)
      .post("/api/queues/feedback")
      .set("Authorization", `Bearer ${token}`)
      .send({ entryId, rating: 4, comment: "  Quick and   friendly " });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.feedback.rating, 4);
    assert.equal(sent.body.feedback.comment, "Quick and friendly");

    const again = await request(app)
      .post("/api/queues/feedback")
      .set("Authorization", `Bearer ${token}`)
      .send({ entryId, rating: 1 });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "already-rated");

    const after2 = await request(app).get("/api/queues/feedback/pending").set("Authorization", `Bearer ${token}`);
    assert.equal(after2.body.pending.length, 0);

    const history = await request(app).get("/api/queues/history").set("Authorization", `Bearer ${token}`);
    const served = history.body.events.find((e) => e.status === "served");
    assert.deepEqual(served.feedback, { rating: 4 });
  });

  it("validates rating, ownership, status and the 7-day window", async () => {
    const token = await register(app, "a@example.com");
    const other = await register(app, "b@example.com");
    const entryId = await joinAndServe(app, queueId, token, admin);

    for (const rating of [0, 6, 3.5, "x", null]) {
      const res = await request(app).post("/api/queues/feedback").set("Authorization", `Bearer ${token}`).send({ entryId, rating });
      assert.equal(res.status, 400, `rating ${rating}`);
    }
    const long = await request(app)
      .post("/api/queues/feedback")
      .set("Authorization", `Bearer ${token}`)
      .send({ entryId, rating: 3, comment: "x".repeat(501) });
    assert.equal(long.status, 400);

    const notMine = await request(app).post("/api/queues/feedback").set("Authorization", `Bearer ${other}`).send({ entryId, rating: 5 });
    assert.equal(notMine.status, 404);

    const waiting = await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${other}`);
    const waitingEntry = await QueueEntry.findOne({ queue: queueId, tokenNumber: waiting.body.tokenNumber });
    const early = await request(app)
      .post("/api/queues/feedback")
      .set("Authorization", `Bearer ${other}`)
      .send({ entryId: waitingEntry._id.toString(), rating: 5 });
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "not-served");

    setNow(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    const late = await request(app).post("/api/queues/feedback").set("Authorization", `Bearer ${token}`).send({ entryId, rating: 5 });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, "too-late");

    const anon = await request(app).post("/api/queues/feedback").send({ entryId, rating: 5 });
    assert.equal(anon.status, 401);
  });

  it("is rate-limited per client", async () => {
    const limited = testApp({ rateLimit: true, feedbackRateLimit: { windowMs: 60_000, max: 2 } });
    const token = await register(limited, "c@example.com");
    const codes = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request(limited).post("/api/queues/feedback").set("Authorization", `Bearer ${token}`).send({ entryId: "x", rating: 5 });
      codes.push(res.status);
    }
    assert.deepEqual(codes, [404, 404, 429]);
  });

  it("feeds per-queue and per-counter scores into the report and CSV", async () => {
    const ratings = [5, 4, 2];
    for (const [i, rating] of ratings.entries()) {
      const token = await register(app, `u${i}@example.com`);
      const entryId = await joinAndServe(app, queueId, token, admin);
      const res = await request(app)
        .post("/api/queues/feedback")
        .set("Authorization", `Bearer ${token}`)
        .send({ entryId, rating, comment: i === 2 ? "Long wait at the till" : "" });
      assert.equal(res.status, 201);
    }
    const report = await request(app).get("/api/admin/analytics/report").set("Authorization", `Bearer ${admin}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.totals.ratings, 3);
    assert.equal(report.body.totals.averageRating, 3.7);
    const caf = report.body.queues.find((q) => q.name === "Cafeteria");
    assert.equal(caf.ratings, 3);
    assert.equal(caf.averageRating, 3.7);
    assert.equal(report.body.counters.length, 1);
    assert.equal(report.body.counters[0].queue, "Cafeteria");
    assert.equal(report.body.counters[0].lowRatings, 1);
    assert.equal(report.body.comments.length, 1);
    assert.equal(report.body.comments[0].comment, "Long wait at the till");

    const csv = await request(app).get("/api/admin/analytics/report.csv").set("Authorization", `Bearer ${admin}`);
    const lines = csv.text.trim().split("\n");
    assert.ok(lines.find((l) => l.startsWith("queue,Cafeteria,")).endsWith(",3,3.7"));
    assert.ok(lines.some((l) => l.startsWith("counter,Cafeteria · ") && l.endsWith(",3,3.7")));
  });
});
