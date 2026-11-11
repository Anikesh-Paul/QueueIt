import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { attachEquivalentSuggestions } from "../src/services/equivalentQueues.js";

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
  const join = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${res.body.token}`);
  assert.equal(join.status, 201);
  return { token: res.body.token, entry: join.body };
}

describe("attachEquivalentSuggestions", () => {
  const venue = { id: "v1", name: "Campus" };
  const cafeteria = {
    id: "a",
    name: "Cafeteria",
    venue,
    equivalentGroup: "Food",
    waitingCount: 5,
    acceptingTokens: true,
    status: "open",
  };
  const express = {
    id: "b",
    name: "Cafeteria Express",
    venue,
    equivalentGroup: "food",
    waitingCount: 1,
    acceptingTokens: true,
    status: "open",
  };

  it("suggests a shorter open equivalent and is case-insensitive on the group", () => {
    const [longLine, shortLine] = attachEquivalentSuggestions([cafeteria, express]);
    assert.equal(longLine.shorterEquivalent.id, "b");
    assert.equal(longLine.shorterEquivalent.name, "Cafeteria Express");
    assert.equal(shortLine.shorterEquivalent, null);
  });

  it("does not suggest a closed, full, or ungrouped alternative", () => {
    const closed = { ...express, acceptingTokens: false };
    const [fromClosed] = attachEquivalentSuggestions([cafeteria, closed]);
    assert.equal(fromClosed.shorterEquivalent, null);

    const full = { ...express, full: true };
    const [fromFull] = attachEquivalentSuggestions([cafeteria, full]);
    assert.equal(fromFull.shorterEquivalent, null);

    const ungrouped = { ...cafeteria, equivalentGroup: null };
    const [fromNone] = attachEquivalentSuggestions([ungrouped, express]);
    assert.equal(fromNone.shorterEquivalent, null);
  });
});

describe("Smart routing", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("suggests a shorter equivalent queue on the catalog, and not when it is closed", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const app = testApp();
    const admin = await createAdmin(app);
    const venueId = cafeteria.venue.toString();

    const created = await request(app)
      .post("/api/admin/queues")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        venueId,
        name: "Cafeteria Express",
        averageServiceTime: 3,
        equivalentGroup: "Campus food",
      });
    assert.equal(created.status, 201, created.body.error);
    const expressId = created.body.queue.id;

    const grouped = await request(app)
      .patch(`/api/admin/queues/${cafeteria._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ equivalentGroup: "Campus food" });
    assert.equal(grouped.status, 200);

    await joinAs(app, cafeteria._id.toString(), "long-line@example.com");
    await joinAs(app, cafeteria._id.toString(), "long-line-2@example.com");

    const catalog = await request(app).get("/api/queues");
    assert.equal(catalog.status, 200);
    const longCard = catalog.body.queues.find((queue) => queue.id === cafeteria._id.toString());
    const shortCard = catalog.body.queues.find((queue) => queue.id === expressId);
    assert.ok(longCard.shorterEquivalent);
    assert.equal(longCard.shorterEquivalent.id, expressId);
    assert.equal(longCard.shorterEquivalent.name, "Cafeteria Express");
    assert.equal(shortCard.shorterEquivalent, null);

    await request(app)
      .post(`/api/admin/queues/${expressId}/stop-accepting`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});

    const closedCatalog = await request(app).get("/api/queues");
    const longAfter = closedCatalog.body.queues.find((queue) => queue.id === cafeteria._id.toString());
    assert.equal(longAfter.shorterEquivalent, null);
  });

  it("assigns the next call to the idle counter that has waited longest", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);

    const added = await request(app)
      .post(`/api/admin/queues/${queueId}/counters`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Counter 2" });
    assert.equal(added.status, 201, added.body.error);
    const [counter1, counter2] = added.body.queue.counters;

    await joinAs(app, queueId, "fair-a@example.com");
    await joinAs(app, queueId, "fair-b@example.com");

    const first = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.called.servingCounterId, counter1.id);

    const served = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(served.status, 200);

    const second = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(second.status, 200);
    assert.equal(second.body.called.servingCounterId, counter2.id);
  });
});
