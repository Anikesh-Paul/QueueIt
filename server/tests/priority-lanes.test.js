import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { fairCallOrder } from "../src/services/priorityLane.js";

async function createAdmin(app) {
  const password = "password123";
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword(password),
    role: "admin",
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function joinAs(app, queueId, email) {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name: email.split("@")[0],
  });
  assert.equal(res.status, 201);
  const token = res.body.token;
  const join = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(join.status, 201);
  return { token, entry: join.body };
}

async function seedCafeteria(k = 3) {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  cafeteria.priorityEveryK = k;
  cafeteria.regularServesSincePriority = Math.max(0, k - 1);
  await cafeteria.save();
  return cafeteria;
}

describe("fairCallOrder", () => {
  it("keeps unmarked entries in wait order", () => {
    const waiters = [
      { tokenNumber: 1, waitOrder: 1000, priority: false },
      { tokenNumber: 2, waitOrder: 2000, priority: false },
      { tokenNumber: 3, waitOrder: 3000, priority: false },
    ];
    const ordered = fairCallOrder(waiters, { priorityEveryK: 3, regularServesSincePriority: 2 });
    assert.deepEqual(ordered.map((row) => row.tokenNumber), [1, 2, 3]);
  });

  it("lets an approved priority go first, then K-1 regulars, then the next priority", () => {
    const waiters = [
      { tokenNumber: 1, waitOrder: 1000, priority: true },
      { tokenNumber: 2, waitOrder: 2000, priority: false },
      { tokenNumber: 3, waitOrder: 3000, priority: false },
      { tokenNumber: 4, waitOrder: 4000, priority: true },
      { tokenNumber: 5, waitOrder: 5000, priority: false },
    ];
    const ordered = fairCallOrder(waiters, { priorityEveryK: 3, regularServesSincePriority: 2 });
    assert.deepEqual(ordered.map((row) => row.tokenNumber), [1, 2, 3, 4, 5]);
  });

  it("skips priority when the fairness slot is closed, unless only priority remains", () => {
    const waiters = [
      { tokenNumber: 1, waitOrder: 1000, priority: true },
      { tokenNumber: 2, waitOrder: 2000, priority: false },
      { tokenNumber: 3, waitOrder: 3000, priority: false },
    ];
    const blocked = fairCallOrder(waiters, { priorityEveryK: 3, regularServesSincePriority: 0 });
    assert.deepEqual(blocked.map((row) => row.tokenNumber), [2, 3, 1]);
    const onlyP = fairCallOrder(
      [
        { tokenNumber: 1, waitOrder: 1000, priority: true },
        { tokenNumber: 4, waitOrder: 4000, priority: true },
      ],
      { priorityEveryK: 3, regularServesSincePriority: 0 }
    );
    assert.deepEqual(onlyP.map((row) => row.tokenNumber), [1, 4]);
  });
});

describe("Priority lanes", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("lets staff mark priority with a reason, shows a tag, and writes the audit log", async () => {
    const cafeteria = await seedCafeteria();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await joinAs(app, queueId, "priority-mark@example.com");
    await joinAs(app, queueId, "regular-1@example.com");

    const before = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    const firstId = before.body.waiting.find((entry) => entry.tokenNumber === first.entry.tokenNumber).id;

    const marked = await request(app)
      .post(`/api/admin/queues/${queueId}/entries/${firstId}/priority`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ reason: "accessibility" });
    assert.equal(marked.status, 200, marked.body.error);
    assert.equal(marked.body.entry.priority, true);
    assert.equal(marked.body.entry.priorityReason, "accessibility");

    const list = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(list.status, 200);
    const row = list.body.waiting.find((entry) => entry.tokenNumber === first.entry.tokenNumber);
    assert.equal(row.priority, true);
    assert.equal(row.priorityReason, "accessibility");
    assert.equal(row.position, 1);

    const audit = await request(app)
      .get(`/api/admin/audit?queueId=${queueId}`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(audit.status, 200);
    assert.ok(
      (audit.body.events || []).some((row) => row.action === "priority-set"),
      `expected priority-set in audit, got ${JSON.stringify(audit.body).slice(0, 400)}`
    );
  });

  it("keeps a pending student request from jumping, then honours approve and reject", async () => {
    const cafeteria = await seedCafeteria();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await joinAs(app, queueId, "hold-place@example.com");
    const second = await joinAs(app, queueId, "self-request@example.com");

    const pending = await request(app)
      .post(`/api/queues/${queueId}/priority-request`)
      .set("Authorization", `Bearer ${second.token}`)
      .send({ reason: "pregnancy" });
    assert.equal(pending.status, 200, pending.body.error);
    assert.equal(pending.body.priority, false);
    assert.equal(pending.body.priorityRequestStatus, "pending");
    assert.equal(pending.body.priorityReason, "pregnancy");
    // Second joiner is still behind the first regular.
    assert.equal(pending.body.position, 2);

    const listed = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    const secondId = listed.body.waiting.find((entry) => entry.tokenNumber === second.entry.tokenNumber).id;

    const rejected = await request(app)
      .post(`/api/admin/queues/${queueId}/entries/${secondId}/priority-decision`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ approve: false });
    assert.equal(rejected.status, 200, rejected.body.error);
    assert.equal(rejected.body.entry.priority, false);
    assert.equal(rejected.body.entry.priorityRequestStatus, "rejected");

    const again = await request(app)
      .post(`/api/queues/${queueId}/priority-request`)
      .set("Authorization", `Bearer ${second.token}`)
      .send({ reason: "medical" });
    assert.equal(again.status, 200, again.body.error);

    const list = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    const pendingRow = list.body.waiting.find((entry) => entry.tokenNumber === second.entry.tokenNumber);
    const approved = await request(app)
      .post(`/api/admin/queues/${queueId}/entries/${pendingRow.id}/priority-decision`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ approve: true });
    assert.equal(approved.status, 200, approved.body.error);
    assert.equal(approved.body.entry.priority, true);
    assert.equal(approved.body.entry.priorityRequestStatus, "approved");

    const status = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${second.token}`);
    assert.equal(status.body.priority, true);
    // Fairness slot is open (default since = K-1), so approved priority is first.
    assert.equal(status.body.position, 1);

    const firstStatus = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(firstStatus.body.priority, false);
    assert.equal(firstStatus.body.position, 2);
  });

  it("limits priority to every Kth serve and leaves unmarked entries in normal order", async () => {
    const cafeteria = await seedCafeteria(3);
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const a = await joinAs(app, queueId, "prio-a@example.com");
    const b = await joinAs(app, queueId, "reg-b@example.com");
    const c = await joinAs(app, queueId, "reg-c@example.com");
    const d = await joinAs(app, queueId, "prio-d@example.com");

    const list0 = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    const idA = list0.body.waiting.find((row) => row.tokenNumber === a.entry.tokenNumber).id;
    const idD = list0.body.waiting.find((row) => row.tokenNumber === d.entry.tokenNumber).id;

    const markA = await request(app)
      .post(`/api/admin/queues/${queueId}/entries/${idA}/priority`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ reason: "medical" });
    assert.equal(markA.status, 200);
    const markD = await request(app)
      .post(`/api/admin/queues/${queueId}/entries/${idD}/priority`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ reason: "other" });
    assert.equal(markD.status, 200);

    const call1 = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call1.status, 200);
    assert.equal(call1.body.called.tokenNumber, a.entry.tokenNumber);

    const serve1 = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(serve1.status, 200);
    assert.equal(serve1.body.served.tokenNumber, a.entry.tokenNumber);

    const blocked = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ entryId: idD });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /every 3 serves/i);

    const call2 = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call2.status, 200);
    assert.equal(call2.body.called.tokenNumber, b.entry.tokenNumber);

    const serve2 = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(serve2.status, 200);

    const call3 = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call3.status, 200);
    assert.equal(call3.body.called.tokenNumber, c.entry.tokenNumber);
    await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`);

    const call4 = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(call4.status, 200);
    assert.equal(call4.body.called.tokenNumber, d.entry.tokenNumber);
  });

  it("lets an admin edit the fairness K and rejects an invalid value", async () => {
    const cafeteria = await seedCafeteria();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);

    const patched = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ priorityEveryK: 5 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.queue.priorityEveryK, 5);

    const bad = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ priorityEveryK: 0 });
    assert.equal(bad.status, 400);
  });
});
