import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";

async function makeConsole(app, email, fields) {
  await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword("password123"), ...fields });
  const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function joinAs(app, queueId, email) {
  const reg = await request(app).post("/api/auth/register").send({ email, password: "password123", name: email.split("@")[0] });
  const res = await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${reg.body.token}`);
  assert.equal(res.status, 201);
  return reg.body.token;
}

describe("staff shifts", () => {
  let app;
  let queueId;
  let admin;
  let riya;
  let arjun;
  let c1;
  let c2;
  const shift = (token, counterId, action) =>
    request(app)
      .post(`/api/admin/queues/${queueId}/counters/${counterId}/shift`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action });

  before(async () => {
    await setupTestDb();
    app = testApp();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    await seedVenueAndQueues();
    const queue = await Queue.findOne({ slug: "cafeteria" });
    queue.averageServiceTime = 4;
    queue.counters = [{ name: "Counter 1" }, { name: "Counter 2" }];
    await queue.save();
    queueId = queue._id.toString();
    c1 = queue.counters[0]._id.toString();
    c2 = queue.counters[1]._id.toString();
    admin = await makeConsole(app, "admin@example.com", { role: "admin" });
    riya = await makeConsole(app, "riya@example.com", { role: "staff", staffVenue: queue.venue });
    arjun = await makeConsole(app, "arjun@example.com", { role: "staff", staffVenue: queue.venue });
  });

  it("legacy counters are open, so estimates are unchanged", async () => {
    const student = await joinAs(app, queueId, "s1@example.com");
    const status = await request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${student}`);
    assert.equal(status.body.countersOpen, 2);
    assert.equal(status.body.countersTotal, 2);
    assert.equal(status.body.etaServiceTime, 4);
    assert.equal(status.body.counters[0].state, "open");
  });

  it("a break closes the counter, calls go elsewhere, and the wait stretches", async () => {
    const tokens = [];
    for (let i = 0; i < 3; i += 1) tokens.push(await joinAs(app, queueId, `w${i}@example.com`));
    assert.equal((await shift(riya, c1, "start")).status, 200);
    const brk = await shift(riya, c1, "break");
    assert.equal(brk.status, 200);
    assert.equal(brk.body.board.me.state, "break");
    assert.equal(brk.body.board.me.counter.name, "Counter 1");

    const status = await request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${tokens[2]}`);
    assert.equal(status.body.countersOpen, 1);
    assert.equal(status.body.etaServiceTime, 8);
    assert.equal(status.body.etaMinutes, 24);

    const explicit = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ counterId: c1 });
    assert.equal(explicit.status, 409);
    const auto = await request(app).post(`/api/admin/queues/${queueId}/call`).set("Authorization", `Bearer ${admin}`);
    assert.equal(auto.status, 200);
    const queue = await Queue.findById(queueId);
    assert.equal(queue.counters.find((c) => String(c._id) === c2).nowServing, 1);

    const back = await shift(riya, c1, "back");
    assert.equal(back.status, 200);
    const after2 = await request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${tokens[2]}`);
    assert.equal(after2.body.countersOpen, 2);
    assert.equal(after2.body.etaServiceTime, 4);
  });

  it("can't break or end while someone is called at the counter", async () => {
    await joinAs(app, queueId, "x@example.com");
    await shift(riya, c1, "start");
    await shift(admin, c2, "close");
    const call = await request(app).post(`/api/admin/queues/${queueId}/call`).set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 200);
    const brk = await shift(riya, c1, "break");
    assert.equal(brk.status, 409);
    assert.equal(brk.body.code, "counter-busy");
    assert.equal((await shift(riya, c1, "end")).status, 409);
  });

  it("one counter per person, one person per counter", async () => {
    assert.equal((await shift(riya, c1, "start")).status, 200);
    const taken = await shift(arjun, c1, "start");
    assert.equal(taken.status, 409);
    assert.equal(taken.body.code, "counter-taken");
    const twice = await shift(riya, c2, "start");
    assert.equal(twice.status, 409);
    assert.equal(twice.body.code, "already-on-shift");
    assert.equal((await shift(arjun, c1, "break")).status, 403);
    assert.equal((await shift(arjun, c1, "close")).status, 409);
  });

  it("ending every shift leaves no open counter to call to", async () => {
    await joinAs(app, queueId, "y@example.com");
    await shift(riya, c1, "start");
    await shift(riya, c1, "end");
    await shift(admin, c2, "close");
    const call = await request(app).post(`/api/admin/queues/${queueId}/call`).set("Authorization", `Bearer ${admin}`);
    assert.equal(call.status, 409);
    const board = await request(app).get("/api/admin/shifts").set("Authorization", `Bearer ${riya}`);
    assert.equal(board.status, 200);
    assert.equal(board.body.me, null);
    const caf = board.body.queues.find((q) => q.id === queueId);
    assert.equal(caf.countersOpen, 0);
    assert.deepEqual(caf.counters.map((c) => c.state), ["closed", "closed"]);
    assert.equal(caf.waiting, 1);

    const audit = await AdminAudit.find({ action: /^shift-/ }).sort({ createdAt: 1 });
    assert.deepEqual(audit.map((a) => a.action), ["shift-start", "shift-end", "shift-close"]);
  });

  it("staff only see and change counters in their own venue", async () => {
    const other = await Venue.create({ name: "North Campus", slug: "north" });
    const outsider = await makeConsole(app, "out@example.com", { role: "staff", staffVenue: other._id });
    const res = await shift(outsider, c1, "start");
    assert.equal(res.status, 403);
    const board = await request(app).get("/api/admin/shifts").set("Authorization", `Bearer ${outsider}`);
    assert.equal(board.body.queues.length, 0);
    const bad = await shift(riya, c1, "nap");
    assert.equal(bad.status, 400);
  });
});
