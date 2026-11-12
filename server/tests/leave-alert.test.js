import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { resolveLeave, cleanTravelMinutes, DEFAULT_TRAVEL_MINUTES } from "../src/services/leaveAlert.js";

async function joinAs(app, queueId, email) {
  const reg = await request(app).post("/api/auth/register").send({ email, password: "password123", name: email.split("@")[0] });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const res = await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 201);
  return token;
}

describe("leave-when-it's-time", () => {
  let app;
  let queueId;
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
    await queue.save();
    queueId = queue._id.toString();
  });

  it("resolveLeave maps ETA and travel time to a state", () => {
    const at = new Date("2026-11-13T06:00:00Z");
    assert.equal(resolveLeave({ status: "waiting", etaMinutes: 40, travelMinutes: 10, at }).state, "later");
    const soon = resolveLeave({ status: "waiting", etaMinutes: 14, travelMinutes: 10, at });
    assert.equal(soon.state, "soon");
    assert.equal(soon.leaveInMinutes, 4);
    assert.equal(soon.leaveAt, "2026-11-13T06:04:00.000Z");
    assert.equal(resolveLeave({ status: "waiting", etaMinutes: 8, travelMinutes: 10, at }).state, "now");
    assert.equal(resolveLeave({ status: "waiting", etaMinutes: 8, travelMinutes: 10, paused: true, at }).state, "paused");
    assert.equal(resolveLeave({ status: "serving", etaMinutes: 0, travelMinutes: 10, at }).state, "called");
    assert.equal(resolveLeave({ status: "skipped", etaMinutes: null, at }).state, "unknown");
  });

  it("cleanTravelMinutes accepts whole minutes from 0 to 120", () => {
    assert.equal(cleanTravelMinutes(0), 0);
    assert.equal(cleanTravelMinutes("15"), 15);
    for (const bad of [-1, 121, 2.5, "abc", null, "", true]) assert.equal(cleanTravelMinutes(bad), null);
  });

  it("status carries the default travel time and a leave state", async () => {
    const tokens = [];
    for (let i = 0; i < 5; i += 1) tokens.push(await joinAs(app, queueId, `p${i}@example.com`));
    const res = await request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${tokens[4]}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.travelMinutes, DEFAULT_TRAVEL_MINUTES);
    assert.equal(res.body.travelMinutesSet, false);
    assert.equal(res.body.position, 5);
    assert.equal(res.body.etaMinutes, 20);
    assert.equal(res.body.leave.state, "later");
    assert.equal(res.body.leave.leaveInMinutes, 10);
    assert.ok(res.body.leave.leaveAt);

    const first = await request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${tokens[0]}`);
    assert.equal(first.body.leave.state, "now");
  });

  it("a person can set their travel time; it survives polls", async () => {
    const tokens = [];
    for (let i = 0; i < 5; i += 1) tokens.push(await joinAs(app, queueId, `t${i}@example.com`));
    const set = await request(app)
      .post(`/api/queues/${queueId}/travel`)
      .set("Authorization", `Bearer ${tokens[4]}`)
      .send({ minutes: 18 });
    assert.equal(set.status, 200);
    assert.equal(set.body.travelMinutes, 18);
    assert.equal(set.body.travelMinutesSet, true);
    assert.equal(set.body.leave.state, "soon");
    assert.equal(set.body.leave.leaveInMinutes, 2);

    const poll = await request(app).get(`/api/queues/${queueId}/status`).set("Authorization", `Bearer ${tokens[4]}`);
    assert.equal(poll.body.travelMinutes, 18);

    const active = await request(app).get("/api/queues/active").set("Authorization", `Bearer ${tokens[4]}`);
    assert.equal(active.body.memberships[0].travelMinutes, 18);
  });

  it("rejects bad values and people not in the line", async () => {
    const token = await joinAs(app, queueId, "a@example.com");
    const bad = await request(app).post(`/api/queues/${queueId}/travel`).set("Authorization", `Bearer ${token}`).send({ minutes: 500 });
    assert.equal(bad.status, 400);
    const other = await Queue.findOne({ slug: { $ne: "cafeteria" } });
    const missing = await request(app)
      .post(`/api/queues/${other._id}/travel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ minutes: 5 });
    assert.equal(missing.status, 404);
    const anon = await request(app).post(`/api/queues/${queueId}/travel`).send({ minutes: 5 });
    assert.equal(anon.status, 401);
  });
});
