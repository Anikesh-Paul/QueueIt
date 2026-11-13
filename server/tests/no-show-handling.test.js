import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { User } from "../src/models/User.js";
import { setNow, advanceMs, resetClock, now as clockNow } from "../src/services/clock.js";
import {
  FREQUENT_NO_SHOW_THRESHOLD,
  countNoShows,
  isFrequentNoShow,
} from "../src/services/noShowTracker.js";

async function registerUser(app, email, name = email.split("@")[0]) {
  const res = await request(app).post("/api/auth/register").send({ email, password: "password123", name });
  assert.equal(res.status, 201);
  return { token: res.body.token, user: res.body.user };
}

async function createAdmin(app) {
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword("password123"),
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({ email: "admin@example.com", password: "password123" });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function seedQueue({ autoCall = false } = {}) {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  cafeteria.noShowMinutes = 2;
  cafeteria.noShowAutoCall = autoCall;
  await cafeteria.save();
  return cafeteria._id.toString();
}

const join = (app, queueId, token) =>
  request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${token}`);
const call = (app, queueId, admin) =>
  request(app).post(`/api/admin/queues/${queueId}/call`).set("Authorization", `Bearer ${admin}`);
const status = (app, queueId, token) =>
  request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${token}`);
const list = (app, queueId, admin) =>
  request(app).get(`/api/admin/queues/${queueId}/waiting-list`).set("Authorization", `Bearer ${admin}`);

/** Past no-show rows written straight to the DB (old-style or new-style). */
async function pastNoShows(queueId, userId, count, { legacy = false, daysAgo = 2, startToken = 900 } = {}) {
  const at = new Date(clockNow().getTime() - daysAgo * 24 * 60 * 60 * 1000);
  for (let i = 0; i < count; i += 1) {
    await QueueEntry.create({
      queue: queueId,
      user: userId,
      tokenNumber: startToken + i,
      status: "skipped",
      calledAt: at,
      skippedAt: at,
      ...(legacy ? {} : { skipReason: "no-show", noShowAt: at }),
    });
  }
}

describe("No-show handling", () => {
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
  });

  it("marks a timed-out call as a no-show and tells the student why", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const student = await registerUser(app, "a@example.com");
    assert.equal((await join(app, queueId, student.token)).status, 201);
    assert.equal((await call(app, queueId, admin)).status, 200);

    advanceMs(2 * 60_000 + 1000);
    const res = await status(app, queueId, student.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "skipped");
    assert.equal(res.body.missedReason, "no-show");
    assert.equal(res.body.missedGraceMinutes, 2);
    assert.equal(res.body.canRecover, true);
    assert.deepEqual(res.body.noShows, { count: 1, threshold: FREQUENT_NO_SHOW_THRESHOLD, windowDays: 30 });

    const entry = await QueueEntry.findOne({ queue: queueId, tokenNumber: 1 });
    assert.equal(entry.skipReason, "no-show");
    assert.ok(entry.noShowAt);

    // Reading again does not double-count or double-log.
    await status(app, queueId, student.token);
    const audits = await AdminAudit.find({ action: "no-show" });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor.id, "system");
    assert.equal(audits[0].meta.tokenNumber, 1);
    assert.equal(audits[0].meta.graceMinutes, 2);
  });

  it("counts a staff skip of a called person, but not of someone still waiting", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const a = await registerUser(app, "a@example.com");
    const b = await registerUser(app, "b@example.com");
    await join(app, queueId, a.token);
    await join(app, queueId, b.token);
    await call(app, queueId, admin);
    const skipCalled = await request(app)
      .post(`/api/admin/queues/${queueId}/skip`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(skipCalled.status, 200);
    const skipWaiting = await request(app)
      .post(`/api/admin/queues/${queueId}/skip`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(skipWaiting.status, 200);

    const first = await QueueEntry.findOne({ queue: queueId, tokenNumber: 1 });
    const second = await QueueEntry.findOne({ queue: queueId, tokenNumber: 2 });
    assert.equal(first.skipReason, "staff");
    assert.ok(first.noShowAt);
    assert.equal(second.skipReason, "staff");
    assert.equal(second.noShowAt, null);
    assert.equal(await countNoShows({ kind: "user", id: a.user.id }), 1);
    assert.equal(await countNoShows({ kind: "user", id: b.user.id }), 0);

    const res = await status(app, queueId, a.token);
    assert.equal(res.body.missedReason, "staff");
  });

  it("flags a frequent no-show once, shows it to staff and logs it", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const student = await registerUser(app, "late@example.com", "Late Larry");
    const other = await registerUser(app, "ontime@example.com");
    // One old-style row (no noShowAt) and one new-style row in the last 30 days, one too old to count.
    await pastNoShows(queueId, student.user.id, 1, { legacy: true });
    await pastNoShows(queueId, student.user.id, 1, { startToken: 950 });
    await pastNoShows(queueId, student.user.id, 1, { daysAgo: 40, startToken: 980 });
    assert.equal(await countNoShows({ kind: "user", id: student.user.id }), 2);

    await join(app, queueId, student.token);
    await join(app, queueId, other.token);
    let rows = (await list(app, queueId, admin)).body;
    assert.equal(rows.waiting[0].noShowCount, 2);
    assert.equal(rows.waiting[0].frequentNoShow, false);
    assert.equal(rows.waiting[1].frequentNoShow, false);
    assert.deepEqual(rows.noShowPolicy, { threshold: 3, windowDays: 30 });

    await call(app, queueId, admin);
    advanceMs(2 * 60_000 + 1000);
    await list(app, queueId, admin); // lazy expiry on the staff poll

    let flags = await AdminAudit.find({ action: "no-show-flag" });
    assert.equal(flags.length, 1);
    assert.equal(flags[0].actor.id, "system");
    assert.equal(flags[0].meta.noShows, 3);
    assert.match(flags[0].meta.person, /Late Larry/);

    // Rejoin keeps the count; the ticket carries the flag for staff.
    const rejoin = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${student.token}`);
    assert.equal(rejoin.status, 200);
    rows = (await list(app, queueId, admin)).body;
    const mine = rows.waiting.find((row) => row.user.email === "late@example.com");
    assert.equal(mine.noShowCount, 3);
    assert.equal(mine.frequentNoShow, true);
    const theirs = rows.waiting.find((row) => row.user.email === "ontime@example.com");
    assert.equal(theirs.frequentNoShow, false);

    // A fourth no-show in the same window does not log a second flag.
    await pastNoShows(queueId, student.user.id, 1, { startToken: 990 });
    await request(app).post(`/api/admin/queues/${queueId}/skip`).set("Authorization", `Bearer ${admin}`);
    await call(app, queueId, admin);
    advanceMs(2 * 60_000 + 1000);
    await list(app, queueId, admin);
    flags = await AdminAudit.find({ action: "no-show-flag" });
    assert.equal(flags.length, 1);

    const audit = await request(app)
      .get("/api/admin/audit?category=operations")
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(audit.status, 200);
    const actions = (audit.body.events || audit.body.items || []).map((row) => row.action);
    assert.ok(actions.includes("no-show-flag"));
  });

  it("calls the next person after a no-show only when the queue opts in", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue({ autoCall: false });
    const app = testApp();
    const admin = await createAdmin(app);
    const a = await registerUser(app, "a@example.com");
    const b = await registerUser(app, "b@example.com");
    await join(app, queueId, a.token);
    await join(app, queueId, b.token);
    await call(app, queueId, admin);
    advanceMs(2 * 60_000 + 1000);
    let rows = (await list(app, queueId, admin)).body.waiting;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "waiting");

    const patch = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ noShowAutoCall: true });
    assert.equal(patch.status, 200);
    const bad = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ noShowAutoCall: "yes" });
    assert.equal(bad.status, 400);

    const c = await registerUser(app, "c@example.com");
    await join(app, queueId, c.token);
    await call(app, queueId, admin); // calls b
    advanceMs(2 * 60_000 + 1000);
    rows = (await list(app, queueId, admin)).body.waiting;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "serving");
    assert.equal(rows[0].tokenNumber, 3);
    assert.ok(rows[0].servingDeadlineAt);
    assert.equal(rows[0].noShowWindowMinutes, 2);
    const bEntry = await QueueEntry.findOne({ queue: queueId, tokenNumber: 2 });
    assert.equal(bEntry.status, "skipped");
    assert.equal(bEntry.skipReason, "no-show");
    const autoCall = await AdminAudit.findOne({ action: "call", "actor.id": "system" });
    assert.equal(autoCall.meta.tokenNumber, 3);
    assert.equal(autoCall.meta.reason, "after a no-show");
  });

  it("does not auto-call to a counter on break", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue({ autoCall: true });
    const app = testApp();
    const admin = await createAdmin(app);
    const a = await registerUser(app, "a@example.com");
    const b = await registerUser(app, "b@example.com");
    await join(app, queueId, a.token);
    await join(app, queueId, b.token);
    await call(app, queueId, admin);
    const queue = await Queue.findById(queueId);
    queue.counters[0].state = "break";
    await queue.save();
    advanceMs(2 * 60_000 + 1000);
    const rows = (await list(app, queueId, admin)).body.waiting;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "waiting");
  });

  it("reports timed-out no-shows and frequent no-shows in analytics", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const student = await registerUser(app, "late@example.com", "Late Larry");
    await pastNoShows(queueId, student.user.id, 3, { daysAgo: 0 });
    const legacyUser = await registerUser(app, "old@example.com");
    await pastNoShows(queueId, legacyUser.user.id, 1, { legacy: true, daysAgo: 0, startToken: 700 });

    const res = await request(app)
      .get(`/api/admin/analytics/report?queueId=${queueId}&from=2026-11-11&to=2026-11-11`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.noShows, 4);
    assert.equal(res.body.totals.timedOutNoShows, 3);
    assert.equal(res.body.queues[0].timedOutNoShows, 3);
    assert.deepEqual(res.body.noShowPolicy, { threshold: 3, windowDays: 30 });
    assert.equal(res.body.frequentNoShows.length, 1);
    assert.equal(res.body.frequentNoShows[0].name, "Late Larry");
    assert.equal(res.body.frequentNoShows[0].email, "late@example.com");
    assert.equal(res.body.frequentNoShows[0].noShows, 3);
  });

  it("counts a rejoined ticket that misses again twice", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    const queueId = await seedQueue();
    const app = testApp();
    const admin = await createAdmin(app);
    const student = await registerUser(app, "again@example.com");
    await join(app, queueId, student.token);
    await call(app, queueId, admin);
    advanceMs(2 * 60_000 + 1000);
    await status(app, queueId, student.token);
    assert.equal(await countNoShows({ kind: "user", id: student.user.id }), 1);
    const rejoin = await request(app)
      .post(`/api/queues/${queueId}/rejoin`)
      .set("Authorization", `Bearer ${student.token}`);
    assert.equal(rejoin.status, 200);
    const entry = await QueueEntry.findOne({ queue: queueId, tokenNumber: 1 });
    assert.equal(entry.skipReason, null);
    assert.ok(entry.noShowAt);
    await call(app, queueId, admin);
    await request(app).post(`/api/admin/queues/${queueId}/skip`).set("Authorization", `Bearer ${admin}`);
    assert.equal(await countNoShows({ kind: "user", id: student.user.id }), 2);
    const res = await status(app, queueId, student.token);
    // Rejoin used up, so the status read no longer finds a recoverable ticket.
    assert.equal(res.status, 404);
  });

  it("treats the threshold as inclusive", () => {
    assert.equal(isFrequentNoShow(FREQUENT_NO_SHOW_THRESHOLD - 1), false);
    assert.equal(isFrequentNoShow(FREQUENT_NO_SHOW_THRESHOLD), true);
  });
});
