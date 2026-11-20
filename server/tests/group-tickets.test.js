import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";
import {
  cleanPartySize,
  groupSettingsOf,
  partySizeOf,
  serviceUnits,
  unitsForCounts,
  unitsThrough,
} from "../src/services/partySize.js";

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function register(app, email) {
  const res = await request(app).post("/api/auth/register").send({ email, password: "password123", name: email.split("@")[0] });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function adminToken(app) {
  await User.create({ email: "admin-groups@example.com", name: "Admin", passwordHash: await User.hashPassword("password123"), role: "admin" });
  const res = await request(app).post("/api/auth/login").send({ email: "admin-groups@example.com", password: "password123" });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function cafeteria() {
  await seedVenueAndQueues();
  return Queue.findOne({ slug: "cafeteria" });
}

describe("Group tickets: pure helpers", () => {
  it("treats older tickets as one person and clamps odd values", () => {
    assert.equal(partySizeOf({}), 1);
    assert.equal(partySizeOf({ partySize: null }), 1);
    assert.equal(partySizeOf({ partySize: 3 }), 3);
    assert.equal(partySizeOf({ partySize: 0 }), 1);
  });

  it("reads queue settings with defaults", () => {
    assert.deepEqual(groupSettingsOf({}), { enabled: true, maxSize: 4, extraPerPerson: 0.5 });
    assert.deepEqual(groupSettingsOf({ groupTicketsEnabled: false, groupMaxSize: 3 }), { enabled: false, maxSize: 1, extraPerPerson: 0.5 });
    assert.equal(groupSettingsOf({ groupMaxSize: 3, groupExtraPerPerson: 0.25 }).maxSize, 3);
  });

  it("validates a requested party size against the queue", () => {
    assert.deepEqual(cleanPartySize(undefined, {}), { value: 1 });
    assert.deepEqual(cleanPartySize("3", {}), { value: 3 });
    assert.equal(cleanPartySize(5, {}).code, "party-size-invalid");
    assert.equal(cleanPartySize(1.5, {}).code, "party-size-invalid");
    assert.equal(cleanPartySize(2, { groupTicketsEnabled: false }).code, "groups-disabled");
    assert.deepEqual(cleanPartySize(1, { groupTicketsEnabled: false }), { value: 1 });
    assert.equal(cleanPartySize(4, { groupMaxSize: 3 }).code, "party-size-too-big");
  });

  it("counts groups as 1 + extra × (people − 1) serves", () => {
    assert.equal(serviceUnits(1, 0.5), 1);
    assert.equal(serviceUnits(4, 0.5), 2.5);
    assert.equal(serviceUnits(3, 0), 1);
    assert.equal(unitsForCounts(3, 6, 0.5), 4.5);
    const ordered = [{ _id: "a", partySize: 4 }, { _id: "b" }, { _id: "c", partySize: 2 }];
    assert.equal(unitsThrough(ordered, { _id: "c" }, 0.5, 3), 5);
    assert.equal(unitsThrough(ordered, { _id: "b" }, 0.5, 2), 3.5);
    assert.equal(unitsThrough(ordered, { _id: "zz" }, 0.5, 7), 7);
  });
});

describe("Group tickets: HTTP", () => {
  before(setupTestDb);
  after(teardownTestDb);
  beforeEach(resetDb);

  it("issues one ticket for a group and stretches the estimate for people behind it", async () => {
    const queue = await cafeteria();
    const app = testApp();
    const ana = await register(app, "ana@example.com");
    const ben = await register(app, "ben@example.com");

    const first = await request(app).post(`/api/queues/${queue._id}/join`).set(auth(ana)).send({ partySize: 3 });
    assert.equal(first.status, 201);
    assert.equal(first.body.partySize, 3);
    assert.deepEqual(first.body.groups, { enabled: true, maxSize: 4, extraPerPerson: 0.5 });
    // Own group: 1 + 0.5 × 2 = 2 serves × 3 min.
    assert.equal(first.body.etaMinutes, 6);
    assert.equal(first.body.position, 1);
    assert.equal(await QueueEntry.countDocuments({ queue: queue._id }), 1);

    const second = await request(app).post(`/api/queues/${queue._id}/join`).set(auth(ben)).send({});
    assert.equal(second.status, 201);
    assert.equal(second.body.partySize, 1);
    assert.equal(second.body.position, 2);
    // Group ahead (2 serves) + me (1) = 3 × 3 min.
    assert.equal(second.body.etaMinutes, 9);
  });

  it("guests can join as a group too, and bad sizes are refused before a pass is minted", async () => {
    const queue = await cafeteria();
    const app = testApp();
    const bad = await request(app).post(`/api/queues/${queue._id}/join`).send({ partySize: 9 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "party-size-invalid");
    assert.equal(await QueueEntry.countDocuments(), 0);

    const ok = await request(app).post(`/api/queues/${queue._id}/join`).send({ partySize: 2 });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.partySize, 2);
    const status = await request(app).get(`/api/queues/${queue._id}/status`).set("x-guest-credential", ok.body.guestCredential);
    assert.equal(status.body.partySize, 2);
  });

  it("respects the per-queue maximum and the off switch", async () => {
    const queue = await cafeteria();
    const app = testApp();
    const admin = await adminToken(app);
    const student = await register(app, "cara@example.com");

    const setMax = await request(app).patch(`/api/admin/queues/${queue._id}`).set(auth(admin)).send({ groupMaxSize: 2, groupExtraPerPerson: 0.25 });
    assert.equal(setMax.status, 200);
    const tooBig = await request(app).post(`/api/queues/${queue._id}/join`).set(auth(student)).send({ partySize: 3 });
    assert.equal(tooBig.status, 400);
    assert.equal(tooBig.body.code, "party-size-too-big");

    const off = await request(app).patch(`/api/admin/queues/${queue._id}`).set(auth(admin)).send({ groupTicketsEnabled: false });
    assert.equal(off.status, 200);
    const catalog = await request(app).get("/api/queues");
    assert.deepEqual(catalog.body.queues.find((q) => q.id === String(queue._id)).groups, { enabled: false, maxSize: 1, extraPerPerson: 0.25 });
    const refused = await request(app).post(`/api/queues/${queue._id}/join`).set(auth(student)).send({ partySize: 2 });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "groups-disabled");
    const single = await request(app).post(`/api/queues/${queue._id}/join`).set(auth(student)).send({ partySize: 1 });
    assert.equal(single.status, 201);

    for (const body of [{ groupMaxSize: 5 }, { groupMaxSize: 1 }, { groupExtraPerPerson: 2 }, { groupTicketsEnabled: "yes" }]) {
      const res = await request(app).patch(`/api/admin/queues/${queue._id}`).set(auth(admin)).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("lets a waiting student shrink (never grow) their group", async () => {
    const queue = await cafeteria();
    const app = testApp();
    const student = await register(app, "dev@example.com");
    await request(app).post(`/api/queues/${queue._id}/join`).set(auth(student)).send({ partySize: 4 });

    const grow = await request(app).post(`/api/queues/${queue._id}/party-size`).set(auth(student)).send({ partySize: 4 + 0 });
    assert.equal(grow.status, 200);
    const bigger = await request(app).post(`/api/queues/${queue._id}/party-size`).set(auth(student)).send({ partySize: 5 });
    assert.equal(bigger.status, 400);
    const shrink = await request(app).post(`/api/queues/${queue._id}/party-size`).set(auth(student)).send({ partySize: 2 });
    assert.equal(shrink.status, 200);
    assert.equal(shrink.body.partySize, 2);
    assert.equal(shrink.body.etaMinutes, 4.5);
    const up = await request(app).post(`/api/queues/${queue._id}/party-size`).set(auth(student)).send({ partySize: 3 });
    assert.equal(up.status, 400);
    assert.equal(up.body.code, "party-size-increase");

    const stranger = await register(app, "eve@example.com");
    const notIn = await request(app).post(`/api/queues/${queue._id}/party-size`).set(auth(stranger)).send({ partySize: 1 });
    assert.equal(notIn.status, 404);
  });

  it("shows the party size to staff, on the board, and in analytics people counts", async () => {
    const queue = await cafeteria();
    const app = testApp();
    const admin = await adminToken(app);
    const student = await register(app, "fay@example.com");
    await request(app).post(`/api/queues/${queue._id}/join`).set(auth(student)).send({ partySize: 3 });
    const walkIn = await request(app).post(`/api/admin/queues/${queue._id}/walk-in`).set(auth(admin)).send({ name: "Family", partySize: 2 });
    assert.equal(walkIn.status, 201);
    const badWalkIn = await request(app).post(`/api/admin/queues/${queue._id}/walk-in`).set(auth(admin)).send({ name: "Bus", partySize: 7 });
    assert.equal(badWalkIn.status, 400);

    const list = await request(app).get(`/api/admin/queues/${queue._id}/waiting-list`).set(auth(admin));
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.waiting.map((w) => w.partySize), [3, 2]);
    assert.deepEqual(list.body.queue.groups, { enabled: true, maxSize: 4, extraPerPerson: 0.5 });

    const live = await request(app).get("/api/admin/live").set(auth(admin));
    assert.equal(live.body.totals.waitingCount, 2);
    assert.equal(live.body.totals.waitingPeople, 5);

    const call = await request(app).post(`/api/admin/queues/${queue._id}/call`).set(auth(admin)).send({});
    assert.equal(call.status, 200);
    const board = await request(app).get(`/api/queues/${queue._id}/board`);
    const called = board.body.queue.counters.find((c) => c.nowServing != null);
    assert.equal(called.nowServingPartySize, 3);
    assert.equal(JSON.stringify(board.body).includes("fay@"), false);

    const served = await request(app).post(`/api/admin/queues/${queue._id}/serve`).set(auth(admin)).send({});
    assert.equal(served.status, 200);
    const campus = await request(app).get("/api/admin/analytics?window=all").set(auth(admin));
    assert.equal(campus.body.metrics.servedCount, 1);
    assert.equal(campus.body.metrics.servedPeople, 3);
    assert.equal(campus.body.metrics.waitingPeople, 2);
    const report = await request(app).get("/api/admin/analytics/report").set(auth(admin));
    assert.equal(report.body.totals.served, 1);
    assert.equal(report.body.totals.peopleServed, 3);
    const csv = await request(app).get("/api/admin/analytics/report.csv").set(auth(admin));
    assert.ok(csv.text.split("\n")[0].includes("served,people_served,"));
  });

  it("keeps older tickets (no partySize field) at one person", async () => {
    const queue = await cafeteria();
    await QueueEntry.collection.insertOne({ queue: queue._id, isWalkIn: true, walkInName: "Old", tokenNumber: 50, waitOrder: 50000, status: "waiting", createdAt: new Date(), updatedAt: new Date() });
    const app = testApp();
    const admin = await adminToken(app);
    const list = await request(app).get(`/api/admin/queues/${queue._id}/waiting-list`).set(auth(admin));
    assert.equal(list.body.waiting[0].partySize, 1);
    const live = await request(app).get("/api/admin/live").set(auth(admin));
    assert.equal(live.body.totals.waitingPeople, 1);
  });
});
