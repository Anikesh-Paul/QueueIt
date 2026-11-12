import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { setNow, resetClock } from "../src/services/clock.js";
import {
  campusDateOf,
  campusDayStart,
  noShowRate,
  percentile,
  resolveReportRange,
  formatAnalyticsReportCsv,
} from "../src/services/analyticsReport.js";

let tokenSeq = 1;

async function login(app, email, password = "password123") {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function makeUser(fields) {
  return User.create({ name: "Person", passwordHash: await User.hashPassword("password123"), ...fields });
}

/** Insert a finished entry with explicit timestamps (bypasses timestamps). */
async function finished(queueId, status, { joined, called, at }) {
  tokenSeq += 1;
  const doc = {
    queue: queueId,
    isWalkIn: true,
    walkInName: `W${tokenSeq}`,
    tokenNumber: tokenSeq,
    waitOrder: tokenSeq * 1000,
    status,
    createdAt: new Date(joined),
    updatedAt: new Date(at),
    calledAt: called ? new Date(called) : null,
    servedAt: status === "served" ? new Date(at) : null,
    skippedAt: status === "skipped" ? new Date(at) : null,
  };
  await QueueEntry.collection.insertOne(doc);
}

describe("analytics report helpers", () => {
  it("maps instants to campus dates across the IST midnight", () => {
    assert.equal(campusDateOf(new Date("2026-11-10T18:29:00Z")), "2026-11-10");
    assert.equal(campusDateOf(new Date("2026-11-10T18:30:00Z")), "2026-11-11");
    assert.equal(campusDayStart("2026-11-11").toISOString(), "2026-11-10T18:30:00.000Z");
    assert.equal(campusDayStart("2026-02-30"), null);
    assert.equal(campusDayStart("11/11/2026"), null);
  });

  it("defaults to the last 7 campus days and validates ranges", () => {
    const at = new Date("2026-11-12T04:00:00Z");
    const r = resolveReportRange({}, at);
    assert.equal(r.ok, true);
    assert.equal(r.fromDate, "2026-11-06");
    assert.equal(r.toDate, "2026-11-12");
    assert.equal(r.days.length, 7);
    assert.equal(resolveReportRange({ from: "2026-11-12", to: "2026-11-01" }, at).ok, false);
    assert.equal(resolveReportRange({ from: "2026-01-01", to: "2026-11-01" }, at).ok, false);
    assert.equal(resolveReportRange({ from: "bad" }, at).ok, false);
    const one = resolveReportRange({ from: "2026-11-12", to: "2026-11-12" }, at);
    assert.deepEqual(one.days, ["2026-11-12"]);
  });

  it("computes no-show rate and percentiles", () => {
    assert.equal(noShowRate(0, 0), null);
    assert.equal(noShowRate(3, 1), 0.25);
    assert.equal(percentile([], 90), null);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
    assert.equal(percentile([5], 90), 5);
  });

  it("neutralises formula injection in CSV cells", () => {
    const csv = formatAnalyticsReportCsv({
      range: { from: "2026-11-01", to: "2026-11-01" },
      venue: null,
      totals: { served: 0, noShows: 0, left: 0, noShowRate: null, averageWaitMinutes: null, p90WaitMinutes: null },
      daily: [],
      hourly: [],
      queues: [{ name: "=HYPERLINK(1)", venue: "A, B", served: 1, noShows: 0, left: 0, noShowRate: 0, averageWaitMinutes: 2, p90WaitMinutes: 2 }],
    });
    assert.match(csv, /queue,'=HYPERLINK\(1\),"A, B",1,0,0,0\.0,2,2/);
  });
});

describe("GET /api/admin/analytics/report", () => {
  let app;
  let campus;
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
    setNow("2026-11-12T06:30:00Z"); // 12:00 IST Thu
    ({ venue: campus } = await seedVenueAndQueues());
    cafeteria = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    app = testApp();

    // Cafeteria, 11 Nov: two served at 10:xx IST (waits 4 and 8 min to call), one no-show.
    await finished(cafeteria._id, "served", {
      joined: "2026-11-11T10:00:00+05:30",
      called: "2026-11-11T10:04:00+05:30",
      at: "2026-11-11T10:06:00+05:30",
    });
    await finished(cafeteria._id, "served", {
      joined: "2026-11-11T10:10:00+05:30",
      called: "2026-11-11T10:18:00+05:30",
      at: "2026-11-11T10:20:00+05:30",
    });
    await finished(cafeteria._id, "skipped", {
      joined: "2026-11-11T10:20:00+05:30",
      called: "2026-11-11T10:25:00+05:30",
      at: "2026-11-11T10:28:00+05:30",
    });
    // Gym, 12 Nov 00:10 IST (still 11 Nov in UTC) — must land on 12 Nov.
    await finished(gym._id, "served", {
      joined: "2026-11-12T00:00:00+05:30",
      called: null,
      at: "2026-11-12T00:10:00+05:30",
    });
    await finished(gym._id, "left", { joined: "2026-11-12T09:00:00+05:30", at: "2026-11-12T09:05:00+05:30" });
    // Out of range (2 Nov) — ignored by a 7-day window.
    await finished(gym._id, "served", {
      joined: "2026-11-02T09:00:00+05:30",
      called: "2026-11-02T09:30:00+05:30",
      at: "2026-11-02T09:35:00+05:30",
    });
  });
  afterEach(() => {
    resetClock();
  });

  it("401s without a token and 403s a student", async () => {
    const anon = await request(app).get("/api/admin/analytics/report");
    assert.equal(anon.status, 401);
    await makeUser({ email: "s@example.com" });
    const student = await login(app, "s@example.com");
    const res = await request(app).get("/api/admin/analytics/report").set("Authorization", `Bearer ${student}`);
    assert.equal(res.status, 403);
    const csv = await request(app).get("/api/admin/analytics/report.csv").set("Authorization", `Bearer ${student}`);
    assert.equal(csv.status, 403);
  });

  it("returns totals, a zero-filled daily series, hourly buckets and per-queue rows", async () => {
    await makeUser({ email: "a@example.com", role: "admin" });
    const admin = await login(app, "a@example.com");
    const res = await request(app).get("/api/admin/analytics/report").set("Authorization", `Bearer ${admin}`);
    assert.equal(res.status, 200);
    const body = res.body;
    assert.deepEqual(body.range, { from: "2026-11-06", to: "2026-11-12", days: 7 });
    assert.equal(body.daily.length, 7);
    assert.equal(body.hourly.length, 24);
    assert.equal(body.totals.served, 3);
    assert.equal(body.totals.noShows, 1);
    assert.equal(body.totals.left, 1);
    assert.equal(body.totals.noShowRate, 0.25);
    // waits: 4, 8 (join→called) and 10 (no calledAt → served time)
    assert.equal(body.totals.averageWaitMinutes, 7.3);
    assert.equal(body.totals.p90WaitMinutes, 10);
    assert.equal(body.totals.peakHour, 10);
    assert.deepEqual(body.totals.busiestDay, { date: "2026-11-11", served: 2 });

    const d11 = body.daily.find((d) => d.date === "2026-11-11");
    const d12 = body.daily.find((d) => d.date === "2026-11-12");
    const d06 = body.daily.find((d) => d.date === "2026-11-06");
    assert.deepEqual(d11, { date: "2026-11-11", served: 2, noShows: 1, left: 0, averageWaitMinutes: 6 });
    assert.equal(d12.served, 1);
    assert.equal(d12.left, 1);
    assert.deepEqual(d06, { date: "2026-11-06", served: 0, noShows: 0, left: 0, averageWaitMinutes: null });
    assert.equal(body.hourly[10].served, 2);
    assert.equal(body.hourly[0].served, 1);

    const caf = body.queues.find((q) => q.id === String(cafeteria._id));
    assert.equal(caf.served, 2);
    assert.equal(caf.noShows, 1);
    assert.equal(caf.noShowRate, 0.333);
    assert.equal(caf.averageWaitMinutes, 6);
  });

  it("honours a custom range and queue filter", async () => {
    await makeUser({ email: "a@example.com", role: "admin" });
    const admin = await login(app, "a@example.com");
    const res = await request(app)
      .get(`/api/admin/analytics/report?from=2026-11-01&to=2026-11-03&queueId=${gym._id}`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.served, 1);
    assert.equal(res.body.totals.averageWaitMinutes, 30);
    assert.equal(res.body.queues.length, 1);
    assert.equal(res.body.queues[0].name, "Gym");
  });

  it("400s on a bad or oversized range", async () => {
    await makeUser({ email: "a@example.com", role: "admin" });
    const admin = await login(app, "a@example.com");
    for (const qs of ["from=2026-13-01", "from=2026-11-10&to=2026-11-01", "from=2026-01-01&to=2026-11-12"]) {
      const res = await request(app).get(`/api/admin/analytics/report?${qs}`).set("Authorization", `Bearer ${admin}`);
      assert.equal(res.status, 400, qs);
    }
  });

  it("scopes staff to their venue and assigned queues", async () => {
    const other = await Venue.create({ name: "North Block", slug: "north-block" });
    await makeUser({ email: "st@example.com", role: "staff", staffVenue: campus._id, staffQueues: [cafeteria._id] });
    const staff = await login(app, "st@example.com");
    const res = await request(app).get("/api/admin/analytics/report").set("Authorization", `Bearer ${staff}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.queues.map((q) => q.name), ["Cafeteria"]);
    assert.equal(res.body.totals.served, 2);
    assert.equal(res.body.venue.name, campus.name);

    const otherVenue = await request(app)
      .get(`/api/admin/analytics/report?venueId=${other._id}`)
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(otherVenue.status, 403);
    const gymOnly = await request(app)
      .get(`/api/admin/analytics/report?queueId=${gym._id}`)
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(gymOnly.status, 403);
  });

  it("exports the same report as CSV", async () => {
    await makeUser({ email: "a@example.com", role: "admin" });
    const admin = await login(app, "a@example.com");
    const res = await request(app).get("/api/admin/analytics/report.csv").set("Authorization", `Bearer ${admin}`);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/csv/);
    assert.match(res.headers["content-disposition"], /queueit-report-2026-11-06-to-2026-11-12\.csv/);
    const lines = res.text.trim().split("\n");
    assert.equal(lines[0], "section,label,venue,served,no_shows,left,no_show_rate_pct,avg_wait_min,p90_wait_min,ratings,avg_rating");
    assert.equal(lines[1], "summary,2026-11-06 to 2026-11-12,All venues,3,1,1,25.0,7.3,10,0,");
    assert.ok(lines.includes("daily,2026-11-11,,2,1,0,33.3,6,,,"));
    assert.ok(lines.includes("hourly,10:00 IST,,2,,,,,,,"));
    assert.equal(lines.filter((l) => l.startsWith("daily,")).length, 7);
    assert.equal(lines.filter((l) => l.startsWith("hourly,")).length, 24);
  });
});
