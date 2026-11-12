import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import { setNow, resetClock } from "../src/services/clock.js";
import {
  blendPace,
  estimateRange,
  historyWindows,
  recentWeight,
  serveIntervals,
  summarizeIntervals,
} from "../src/services/smartEstimate.js";

const MIN = 60_000;
const WEEK = 7 * 24 * 60 * MIN;

describe("smart estimate (pure)", () => {
  it("drops lulls longer than 30 minutes from serve intervals", () => {
    const t0 = Date.parse("2026-11-04T05:00:00Z");
    const times = [0, 4, 8, 60, 64].map((m) => new Date(t0 + m * MIN));
    assert.deepEqual(serveIntervals(times), [4, 4, 4]);
  });

  it("summarizes mean and spread", () => {
    const s = summarizeIntervals([2, 4, 6]);
    assert.equal(s.count, 3);
    assert.equal(s.mean, 4);
    assert.ok(Math.abs(s.cv - 0.5) < 1e-9);
    assert.equal(summarizeIntervals([]).mean, null);
  });

  it("keeps the old rule when there is no history", () => {
    const recent = { pace: 2, source: "recent", intervalCount: 3 };
    assert.deepEqual(blendPace({ recent, history: { count: 0, mean: null }, configured: 3 }).pace, 2);
    assert.equal(blendPace({ recent, history: { count: 0, mean: null }, configured: 3 }).source, "recent");
    const none = blendPace({ recent: { pace: 3, source: "configured", intervalCount: 0 }, history: { count: 2, mean: 9 }, configured: 3 });
    assert.equal(none.source, "configured");
    assert.equal(none.pace, 3);
  });

  it("uses history alone early in the day and blends once today has serves", () => {
    const history = { count: 12, mean: 5 };
    const early = blendPace({ recent: { pace: 3, source: "configured", intervalCount: 1 }, history, configured: 3 });
    assert.equal(early.source, "history");
    assert.equal(early.pace, 5);
    const mid = blendPace({ recent: { pace: 2, source: "recent", intervalCount: 3 }, history, configured: 3 });
    assert.equal(mid.source, "blend");
    assert.equal(mid.weightRecent, 0.5);
    assert.equal(mid.pace, 3.5);
    // Today's pace dominates as its sample grows, but history still counts.
    assert.equal(recentWeight(10), 0.8);
  });

  it("clamps typical pace to the same bounds as today's pace", () => {
    const wild = blendPace({ recent: { pace: 3, source: "configured", intervalCount: 0 }, history: { count: 8, mean: 30 }, configured: 3 });
    assert.equal(wild.pace, 6);
  });

  it("narrows the range as data and position grow", () => {
    const thin = estimateRange({ etaMinutes: 20, position: 4, cv: null, source: "configured" });
    const thick = estimateRange({ etaMinutes: 20, position: 4, cv: 0.3, source: "blend", sampleSize: 20 });
    assert.equal(thin.confidence, "low");
    assert.ok(thin.high - thin.low > thick.high - thick.low);
    assert.ok(thin.low <= 20 && thin.high >= 20);
    const far = estimateRange({ etaMinutes: 60, position: 20, cv: 0.4, source: "recent", sampleSize: 15 });
    assert.equal(far.confidence, "high");
    assert.ok((far.high - far.low) / 60 < 0.5);
  });

  it("does not invent a range for a very short wait", () => {
    assert.deepEqual(estimateRange({ etaMinutes: 1, position: 1, cv: 0.4, source: "recent" }), { low: 1, high: 1, confidence: "medium" });
  });

  it("looks at the same campus hour on the previous four weeks", () => {
    const at = new Date("2026-11-11T05:20:00Z"); // Wed 10:50 IST
    const windows = historyWindows(at);
    assert.equal(windows.length, 4);
    // 10:00 IST = 04:30 UTC; padded 30 min either side of the hour.
    assert.equal(windows[3].from.toISOString(), "2026-11-04T04:00:00.000Z");
    assert.equal(windows[3].to.toISOString(), "2026-11-04T06:00:00.000Z");
    assert.equal(windows[0].from.toISOString(), new Date(windows[3].from.getTime() - 3 * WEEK).toISOString());
  });
});

describe("smart estimate (status payload)", () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  async function served(queueId, times) {
    const user = await User.create({
      email: `served-${Math.random().toString(36).slice(2)}@example.com`,
      name: "Served",
      passwordHash: await User.hashPassword("password123"),
    });
    let token = 1;
    for (const at of times) {
      const entry = await QueueEntry.create({ queue: queueId, user: user._id, tokenNumber: token++, status: "served" });
      await QueueEntry.collection.updateOne({ _id: entry._id }, { $set: { createdAt: at, updatedAt: at } });
    }
  }

  async function joinAndStatus(app, queueId) {
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ email: "waiter@example.com", password: "password123", name: "Waiter" });
    const token = reg.body.token;
    await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${token}`);
    return request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${token}`);
  }

  it("learns from last week's serves at this hour before today has any", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    try {
      await seedVenueAndQueues();
      const queue = await Queue.findOne({ slug: "cafeteria" });
      const lastWeek = Date.parse("2026-11-04T04:40:00.000Z");
      await served(queue._id, [0, 5, 10, 15, 20, 25, 30].map((m) => new Date(lastWeek + m * MIN)));
      const app = testApp();
      const status = await joinAndStatus(app, queue._id);
      assert.equal(status.status, 200);
      assert.equal(status.body.etaPaceSource, "history");
      assert.equal(status.body.etaServiceTime, 5);
      assert.equal(status.body.etaMinutes, 5);
      assert.deepEqual(status.body.etaRange, { low: 3, high: 7 });
      assert.equal(status.body.etaConfidence, "medium");
      assert.equal(status.body.etaBasis.typicalPace, 5);
      assert.equal(status.body.etaBasis.historyServes, 6);
    } finally {
      resetClock();
    }
  });

  it("blends today's pace with history and reports both", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    try {
      await seedVenueAndQueues();
      const queue = await Queue.findOne({ slug: "cafeteria" });
      const lastWeek = Date.parse("2026-11-04T04:40:00.000Z");
      await served(queue._id, [0, 5, 10, 15, 20, 25, 30].map((m) => new Date(lastWeek + m * MIN)));
      const today = Date.parse("2026-11-11T04:50:00.000Z");
      await served(queue._id, [0, 2, 4, 6].map((m) => new Date(today + m * MIN)));
      const app = testApp();
      const status = await joinAndStatus(app, queue._id);
      assert.equal(status.body.etaPaceSource, "blend");
      // 0.5 × 2 (today) + 0.5 × 5 (typical)
      assert.equal(status.body.etaServiceTime, 3.5);
      assert.equal(status.body.etaBasis.recentPace, 2);
      assert.equal(status.body.etaBasis.typicalPace, 5);
      assert.ok(status.body.etaRange.low <= status.body.etaMinutes);
      assert.ok(status.body.etaRange.high >= status.body.etaMinutes);
    } finally {
      resetClock();
    }
  });

  it("ignores serves from other hours and older than four weeks", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    try {
      await seedVenueAndQueues();
      const queue = await Queue.findOne({ slug: "cafeteria" });
      const otherHour = Date.parse("2026-11-04T10:00:00.000Z");
      const tooOld = Date.parse("2026-10-07T04:40:00.000Z");
      await served(queue._id, [0, 9, 18, 27, 36, 45].map((m) => new Date(otherHour + m * MIN)));
      await served(queue._id, [0, 9, 18, 27, 36, 45].map((m) => new Date(tooOld + m * MIN)));
      const status = await joinAndStatus(testApp(), queue._id);
      assert.equal(status.body.etaPaceSource, "configured");
      assert.equal(status.body.etaServiceTime, 3);
      assert.equal(status.body.etaConfidence, "low");
    } finally {
      resetClock();
    }
  });

  it("gives the catalog a wait range for someone joining now", async () => {
    setNow("2026-11-11T05:00:00.000Z");
    try {
      await seedVenueAndQueues();
      const queue = await Queue.findOne({ slug: "cafeteria" });
      const lastWeek = Date.parse("2026-11-04T04:40:00.000Z");
      await served(queue._id, [0, 5, 10, 15, 20, 25, 30].map((m) => new Date(lastWeek + m * MIN)));
      const app = testApp();
      await joinAndStatus(app, queue._id);
      const list = await request(app).get("/api/queues");
      const row = list.body.queues.find((q) => q.id === String(queue._id));
      // One waiting ahead → second place at 5 min each.
      assert.equal(row.waitEstimate.minutes, 10);
      assert.equal(row.waitEstimate.source, "history");
      assert.ok(row.waitEstimate.low < 10 && row.waitEstimate.high > 10);

      await Queue.updateOne({ _id: queue._id }, { $set: { status: "paused" } });
      const paused = await request(app).get("/api/queues");
      assert.equal(paused.body.queues.find((q) => q.id === String(queue._id)).waitEstimate, null);
    } finally {
      resetClock();
    }
  });
});
