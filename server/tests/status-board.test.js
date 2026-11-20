import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { Venue } from "../src/models/Venue.js";
import { Organization } from "../src/models/Organization.js";
import { resetClock, setNow, advanceMs } from "../src/services/clock.js";
import {
  STATUS_BOARD_CACHE_HEADER,
  STATUS_BOARD_TTL_SECONDS,
  clearStatusBoardCache,
} from "../src/services/statusBoard.js";

const FORBIDDEN_QUEUE_KEYS = [
  "email",
  "walkInName",
  "staffedByName",
  "staffedBy",
  "handover",
  "notes",
  "averageServiceTime",
  "noShowMinutes",
  "noShowMode",
  "recoveryMinutes",
  "guestJoin",
  "maxWaiting",
  "appointments",
  "serviceWindows",
  "serviceExceptions",
  "sessionEndsAt",
  "reopenAt",
  "nextTokenNumber",
];

async function dbFingerprint() {
  const names = Object.keys(mongoose.connection.collections).sort();
  const out = {};
  for (const name of names) {
    const docs = await mongoose.connection.collections[name].find({}).sort({ _id: 1 }).toArray();
    out[name] = JSON.stringify(docs);
  }
  return JSON.stringify(out);
}

function spyDocumentSaves() {
  let count = 0;
  const orig = mongoose.Document.prototype.save;
  mongoose.Document.prototype.save = function spySave(...args) {
    count += 1;
    return orig.apply(this, args);
  };
  return {
    count: () => count,
    restore() {
      mongoose.Document.prototype.save = orig;
    },
  };
}

describe("public status board", () => {
  let app;
  before(async () => {
    await setupTestDb();
    app = testApp();
  });
  after(async () => {
    resetClock();
    clearStatusBoardCache();
    await teardownTestDb();
  });
  beforeEach(async () => {
    resetClock();
    clearStatusBoardCache();
    await resetDb();
    await seedVenueAndQueues();
  });

  it("is public, cached, and returns only public wait fields", async () => {
    const res = await request(app).get("/api/status-board");
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], STATUS_BOARD_CACHE_HEADER);
    assert.match(res.headers["cache-control"], /public/);
    assert.match(res.headers["cache-control"], new RegExp(`max-age=${STATUS_BOARD_TTL_SECONDS}`));
    assert.equal(res.body.cacheTtlSeconds, STATUS_BOARD_TTL_SECONDS);
    assert.ok(Number.isInteger(res.body.refreshSeconds));
    assert.ok(res.body.generatedAt);
    assert.equal((res.body.queues || []).length, 2);
    const names = res.body.queues.map((q) => q.name).sort();
    assert.deepEqual(names, ["Cafeteria", "Gym"]);
    const cafe = res.body.queues.find((q) => q.name === "Cafeteria");
    assert.equal(cafe.venue.name, "Campus Hub");
    assert.equal(cafe.venue.slug, "campus-hub");
    assert.equal(cafe.organization.slug, "main");
    assert.equal(typeof cafe.acceptingTokens, "boolean");
    assert.ok(["open", "paused"].includes(cafe.status));
    assert.equal(cafe.waitingCount, 0);
    assert.equal(cafe.waitingPeople, 0);
    assert.equal(cafe.waitEstimate.source, "empty");
    assert.equal(cafe.waitEstimate.high, 0);
    assert.ok(Array.isArray(cafe.counters));
    assert.ok(Number.isInteger(cafe.openCounters));
    for (const key of FORBIDDEN_QUEUE_KEYS) {
      assert.equal(Object.hasOwn(cafe, key), false, `must not expose ${key}`);
    }
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("averageServiceTime"), false);
    assert.equal(blob.includes("staffedBy"), false);
  });

  it("does not write to the database, even when a session is past its end", async () => {
    const cafe = await Queue.findOne({ slug: "cafeteria" });
    cafe.acceptingTokens = true;
    cafe.sessionEndsAt = new Date("2020-01-01T00:00:00Z");
    cafe.counters = [
      {
        name: "Counter 1",
        nowServing: null,
        state: "open",
        staffedByName: "SECRET_STAFF",
      },
    ];
    await cafe.save();
    clearStatusBoardCache();

    await QueueEntry.create({
      queue: cafe._id,
      isWalkIn: true,
      walkInName: "SECRET_WALKIN",
      tokenNumber: 12,
      status: "waiting",
      partySize: 2,
    });

    const before = await dbFingerprint();
    const spy = spyDocumentSaves();
    let res;
    try {
      res = await request(app).get("/api/status-board");
    } finally {
      spy.restore();
    }
    assert.equal(res.status, 200);
    assert.equal(spy.count(), 0, "must not call Document.save");
    assert.equal(await dbFingerprint(), before);

    const fresh = await Queue.findById(cafe._id);
    assert.equal(fresh.acceptingTokens, true, "session close must not persist");
    assert.equal(new Date(fresh.sessionEndsAt).toISOString(), "2020-01-01T00:00:00.000Z");

    const row = res.body.queues.find((q) => q.name === "Cafeteria");
    assert.equal(row.acceptingTokens, false, "response may project closed without writing");
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("SECRET_WALKIN"), false);
    assert.equal(blob.includes("SECRET_STAFF"), false);
    assert.equal(row.waitingCount, 1);
    assert.equal(row.waitingPeople, 2);
  });

  it("serves from a short in-memory cache, then refreshes after TTL", async () => {
    setNow("2026-11-21T06:00:00Z");
    const first = await request(app).get("/api/status-board");
    assert.equal(first.status, 200);
    await Queue.updateOne({ slug: "cafeteria" }, { $set: { name: "Renamed Cafe" } });
    const cached = await request(app).get("/api/status-board");
    assert.equal(cached.body.generatedAt, first.body.generatedAt);
    assert.ok(cached.body.queues.some((q) => q.name === "Cafeteria"));
    assert.equal(
      cached.body.queues.some((q) => q.name === "Renamed Cafe"),
      false
    );

    advanceMs(STATUS_BOARD_TTL_SECONDS * 1000 + 1);
    const fresh = await request(app).get("/api/status-board");
    assert.notEqual(fresh.body.generatedAt, first.body.generatedAt);
    assert.ok(fresh.body.queues.some((q) => q.name === "Renamed Cafe"));
  });

  it("filters by org or venue without leaking another org's queues", async () => {
    const org = await Organization.create({ name: "City Annex", slug: "city-annex" });
    const venue = await Venue.create({ name: "Outpatient", slug: "outpatient", organization: org._id });
    await Queue.create({
      name: "Pharmacy",
      slug: "pharmacy",
      venue: venue._id,
      averageServiceTime: 4,
      status: "open",
      acceptingTokens: true,
      counters: [{ name: "Window 1", nowServing: null }],
    });
    clearStatusBoardCache();

    const all = await request(app).get("/api/status-board");
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.queues.map((q) => q.name).sort(), ["Cafeteria", "Gym", "Pharmacy"]);

    const annex = await request(app).get("/api/status-board?org=city-annex");
    assert.equal(annex.status, 200);
    assert.deepEqual(annex.body.queues.map((q) => q.name), ["Pharmacy"]);
    assert.equal(annex.body.queues[0].organization.slug, "city-annex");
    assert.equal(
      annex.body.queues.some((q) => q.venue.slug === "campus-hub"),
      false
    );

    const hub = await request(app).get("/api/status-board?venue=campus-hub");
    assert.equal(hub.status, 200);
    assert.deepEqual(hub.body.queues.map((q) => q.name).sort(), ["Cafeteria", "Gym"]);
    assert.equal(
      hub.body.queues.some((q) => q.name === "Pharmacy"),
      false
    );

    const mismatch = await request(app).get("/api/status-board?org=city-annex&venue=campus-hub");
    assert.equal(mismatch.status, 404);
    const missing = await request(app).get("/api/status-board?org=no-such-org");
    assert.equal(missing.status, 404);
    const missingVenue = await request(app).get("/api/status-board?venue=no-such-venue");
    assert.equal(missingVenue.status, 404);
  });

  it("hides archived queues and shows live now-serving tokens only", async () => {
    const cafe = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });
    gym.archivedAt = new Date();
    await gym.save();
    cafe.counters = [{ name: "Counter 1", nowServing: null, state: "open" }];
    await cafe.save();
    const counterId = cafe.counters[0]._id;
    await QueueEntry.create({
      queue: cafe._id,
      isWalkIn: true,
      walkInName: "SECRET_CALLED",
      tokenNumber: 42,
      status: "serving",
      servingCounterId: counterId,
      partySize: 3,
    });
    clearStatusBoardCache();

    const res = await request(app).get("/api/status-board");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.queues.map((q) => q.name), ["Cafeteria"]);
    const row = res.body.queues[0];
    const live = row.counters.find((c) => c.nowServing != null);
    assert.equal(live.nowServing, 42);
    assert.equal(live.nowServingPartySize, 3);
    assert.equal(live.name, "Counter 1");
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("SECRET_CALLED"), false);
    assert.equal(blob.includes("tokenNumber"), false);
  });
});
