import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { resetClock, setNow } from "../src/services/clock.js";
import { buildBestTime, campusSlot, clearBestTimeCache, openHoursFor } from "../src/services/bestTimeChart.js";

/** Instant for a campus (IST) wall time. */
function ist(date, hh, mm = 0) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60_000);
}

// Mondays: 2 Nov, 9 Nov, 16 Nov 2026. "Now" is Monday 23 Nov.
const MONDAYS = ["2026-11-02", "2026-11-09", "2026-11-16"];
const WEEKDAY_HOURS = [{ start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }];

/** 9 AM busy & slow, 12 PM quiet & quick, 3 PM in between; plus noise on other days and after hours. */
function sampleEntries() {
  const out = [];
  for (const day of MONDAYS) {
    for (let i = 0; i < 6; i += 1) out.push({ createdAt: ist(day, 9, i * 5), calledAt: ist(day, 9, i * 5 + 25) });
    out.push({ createdAt: ist(day, 12, 10), calledAt: ist(day, 12, 13) });
    for (let i = 0; i < 3; i += 1) out.push({ createdAt: ist(day, 15, i * 10), calledAt: ist(day, 15, i * 10 + 10) });
    out.push({ createdAt: ist(day, 19, 0) }); // after hours
  }
  out.push({ createdAt: ist("2026-11-17", 12, 0) }); // Tuesday
  return out;
}

describe("best time builder", () => {
  it("reads open hours from weekly windows, including overnight spill", () => {
    assert.equal(openHoursFor([], 1).known, false);
    const mon = openHoursFor([{ start: "09:30", end: "17:00", days: [1, 2, 3, 4, 5] }], 1);
    assert.deepEqual([...mon.hours].sort((a, b) => a - b), [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.equal(openHoursFor([{ start: "09:30", end: "17:00", days: [1] }], 0).hours.size, 0);
    const night = [{ start: "22:00", end: "02:00", days: [5] }];
    assert.deepEqual([...openHoursFor(night, 5).hours].sort((a, b) => a - b), [22, 23]);
    assert.deepEqual([...openHoursFor(night, 6).hours].sort((a, b) => a - b), [0, 1]);
  });

  it("says not enough history below 10 tickets or 2 days", () => {
    const few = sampleEntries().slice(0, 9);
    const r = buildBestTime({ entries: few, serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 10) });
    assert.equal(r.enough, false);
    assert.deepEqual(r.hours, []);
    assert.equal(r.best, null);
    const oneDay = Array.from({ length: 12 }, (_, i) => ({ createdAt: ist("2026-11-16", 9 + (i % 5), i) }));
    assert.equal(buildBestTime({ entries: oneDay, weekday: 1, at: ist("2026-11-23", 10) }).enough, false);
  });

  it("computes crowd, median wait, levels and the best hour within opening hours", () => {
    const r = buildBestTime({ entries: sampleEntries(), serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-20", 10) });
    assert.equal(r.enough, true);
    assert.equal(r.sampleSize, 33);
    assert.equal(r.activeDays, 3);
    const h = (n) => r.hours[n];
    assert.equal(h(9).crowd, 6);
    assert.equal(h(9).waitMinutes, 25);
    assert.equal(h(12).crowd, 1);
    assert.equal(h(12).waitMinutes, 3);
    assert.equal(h(9).level, "busy");
    assert.equal(h(12).level, "quiet");
    assert.equal(h(19).open, false, "after-hours tickets are not an opening hour");
    assert.equal(h(19).level, null);
    assert.equal(h(10).open, true);
    assert.equal(h(10).level, null, "open but no data");
    assert.equal(r.best.hour, 12);
    assert.equal(r.best.label, "12 PM");
    assert.equal(r.now, null, "Friday is not Monday");
    assert.equal(r.nextBest, null);
  });

  it("gives a now badge and the best remaining hour today", () => {
    const busyNow = buildBestTime({ entries: sampleEntries(), serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 9, 30) });
    assert.deepEqual(busyNow.now, { hour: 9, label: "9 AM", open: true, level: "busy" });
    assert.equal(busyNow.nextBest.hour, 12);
    const afternoon = buildBestTime({ entries: sampleEntries(), serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 13, 0) });
    assert.equal(afternoon.nextBest.hour, 15);
    assert.equal(afternoon.now.level, "quiet", "open hour with no history reads as quiet");
    const evening = buildBestTime({ entries: sampleEntries(), serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 20, 0) });
    assert.equal(evening.now.open, false);
    assert.equal(evening.now.level, null);
    assert.equal(evening.nextBest, null);
    // At 3 PM only the 3 PM slot remains; it isn't busy, so it's still offered.
    const late = buildBestTime({ entries: sampleEntries(), serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 15, 10) });
    assert.equal(late.nextBest.hour, 15);
  });

  it("doesn't suggest a later slot when only busy hours remain", () => {
    const busyOnly = sampleEntries().filter((e) => campusSlot(e.createdAt).hour !== 15);
    const r = buildBestTime({ entries: busyOnly, serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 9, 5) });
    assert.equal(r.now.level, "busy");
    assert.equal(r.nextBest.hour, 12);
    // Later in the day only the busy 9 AM-style hours are left → no later suggestion.
    const morningOnly = busyOnly.concat(MONDAYS.map((d) => ({ createdAt: ist(d, 16, 0) })));
    const at1610 = buildBestTime({ entries: morningOnly, serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 16, 10) });
    assert.equal(at1610.hours[16].level, "quiet");
    assert.equal(at1610.nextBest.hour, 16);
    const heavy = busyOnly.concat(MONDAYS.flatMap((d) => Array.from({ length: 8 }, (_, i) => ({ createdAt: ist(d, 16, i) }))));
    const at1605 = buildBestTime({ entries: heavy, serviceWindows: WEEKDAY_HOURS, weekday: 1, at: ist("2026-11-23", 16, 5) });
    assert.equal(at1605.hours[16].level, "busy");
    assert.equal(at1605.nextBest, null);
  });

  it("uses hours with tickets as open when there is no schedule", () => {
    const r = buildBestTime({ entries: sampleEntries(), serviceWindows: [], weekday: 1, at: ist("2026-11-20", 10) });
    assert.equal(r.scheduleKnown, false);
    assert.equal(r.hours[19].open, true);
    assert.equal(r.hours[10].open, false);
  });

  it("maps campus slots in IST", () => {
    assert.deepEqual(campusSlot(ist("2026-11-16", 0, 15)), { weekday: 1, hour: 0, dayKey: "2026-11-16" });
  });
});

describe("GET /api/queues/:id/best-time and /api/queues/best-time", () => {
  let app;
  let cafeteria;
  let gym;
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    resetClock();
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    clearBestTimeCache();
    resetClock();
    app = testApp();
    await seedVenueAndQueues();
    cafeteria = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    await Queue.updateOne({ _id: cafeteria._id }, { $set: { serviceWindows: WEEKDAY_HOURS } });
    let token = 1;
    await QueueEntry.collection.insertMany(
      sampleEntries().map((e) => ({
        queue: cafeteria._id,
        user: new mongoose.Types.ObjectId(),
        guest: null,
        isWalkIn: false,
        tokenNumber: token,
        waitOrder: token++ * 1000,
        status: e.calledAt ? "served" : "left",
        calledAt: e.calledAt || null,
        createdAt: e.createdAt,
        updatedAt: e.createdAt,
      }))
    );
    setNow(ist("2026-11-23", 9, 30));
  });

  it("is public, read-only and briefly cacheable", async () => {
    const before = await Promise.all([Queue.find().lean(), QueueEntry.countDocuments()]);
    const res = await request(app).get(`/api/queues/${cafeteria._id}/best-time`);
    assert.equal(res.status, 200);
    assert.match(res.headers["cache-control"], /public, max-age=120/);
    assert.equal(res.body.weekday, 1, "defaults to today (campus)");
    assert.equal(res.body.enough, true);
    assert.equal(res.body.best.hour, 12);
    assert.equal(res.body.now.level, "busy");
    assert.equal(res.body.hours.length, 24);
    const afterState = await Promise.all([Queue.find().lean(), QueueEntry.countDocuments()]);
    assert.deepEqual(JSON.parse(JSON.stringify(afterState)), JSON.parse(JSON.stringify(before)), "no writes");
  });

  it("follows the weekday picker and reports thin history", async () => {
    const tue = await request(app).get(`/api/queues/${cafeteria._id}/best-time?weekday=2`);
    assert.equal(tue.body.weekday, 2);
    assert.equal(tue.body.enough, false);
    assert.equal(tue.body.sampleSize, 1);
    assert.equal(tue.body.now, null);
    const empty = await request(app).get(`/api/queues/${gym._id}/best-time`);
    assert.equal(empty.body.enough, false);
    assert.equal(empty.body.sampleSize, 0);
  });

  it("validates input", async () => {
    assert.equal((await request(app).get("/api/queues/nope/best-time")).status, 400);
    assert.equal((await request(app).get(`/api/queues/${cafeteria._id}/best-time?weekday=7`)).status, 400);
    assert.equal((await request(app).get(`/api/queues/${cafeteria._id}/best-time?weekday=x`)).status, 400);
    assert.equal((await request(app).get(`/api/queues/${new mongoose.Types.ObjectId()}/best-time`)).status, 404);
    assert.equal((await request(app).get("/api/queues/best-time?weekday=-1")).status, 400);
  });

  it("summarises every listed queue compactly", async () => {
    const res = await request(app).get("/api/queues/best-time");
    assert.equal(res.status, 200);
    assert.match(res.headers["cache-control"], /public/);
    const cafe = res.body.queues.find((q) => q.queueId === String(cafeteria._id));
    const g = res.body.queues.find((q) => q.queueId === String(gym._id));
    assert.equal(cafe.enough, true);
    assert.deepEqual(cafe.bars.map((b) => b.hour), [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.equal(cafe.now.level, "busy");
    assert.equal(cafe.nextBest.hour, 12);
    assert.equal(g.enough, false);
    assert.deepEqual(g.bars, []);
  });

  it("serves from a short cache, then refreshes", async () => {
    const first = await request(app).get(`/api/queues/${cafeteria._id}/best-time`);
    await QueueEntry.collection.insertOne({
      queue: cafeteria._id, user: null, guest: null, isWalkIn: true, walkInName: "x", tokenNumber: 999, waitOrder: 999000,
      status: "left", createdAt: ist("2026-11-16", 10), updatedAt: ist("2026-11-16", 10),
    });
    const cached = await request(app).get(`/api/queues/${cafeteria._id}/best-time`);
    assert.equal(cached.body.sampleSize, first.body.sampleSize);
    setNow(ist("2026-11-23", 9, 36));
    const fresh = await request(app).get(`/api/queues/${cafeteria._id}/best-time`);
    assert.equal(fresh.body.sampleSize, first.body.sampleSize + 1);
  });

  it("ignores tickets older than 8 weeks", async () => {
    await QueueEntry.collection.insertOne({
      queue: gym._id, user: null, guest: null, isWalkIn: true, walkInName: "old", tokenNumber: 1, waitOrder: 1000,
      status: "left", createdAt: ist("2026-09-21", 10), updatedAt: ist("2026-09-21", 10),
    });
    const res = await request(app).get(`/api/queues/${gym._id}/best-time`);
    assert.equal(res.body.sampleSize, 0);
  });
});
