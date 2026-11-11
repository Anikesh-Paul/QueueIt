import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { QueueEntry } from "../src/models/QueueEntry.js";
import { User } from "../src/models/User.js";

async function registerUser(app, email, name = "Student") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    name,
    password: "password123",
  });
  assert.equal(res.status, 201);
  return res.body.token;
}

async function createAdmin(app) {
  const password = "password123";
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword(password),
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({
    email: "admin@example.com",
    password,
  });
  assert.equal(res.status, 200);
  return res.body.token;
}

describe("Optional maxWaiting capacity cap", () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("lets admin set and clear a cap; catalog reports full honestly", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const user = await registerUser(app, "one@example.com", "One");

    const catalogOpen = await request(app).get("/api/queues");
    assert.equal(catalogOpen.status, 200);
    const before = catalogOpen.body.queues.find((q) => q.id === queueId);
    assert.equal(before.maxWaiting, null);
    assert.equal(before.full, false);

    const saved = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ maxWaiting: 1 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.queue.maxWaiting, 1);

    const join = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${user}`);
    assert.equal(join.status, 201);

    const catalogFull = await request(app).get("/api/queues");
    const fullRow = catalogFull.body.queues.find((q) => q.id === queueId);
    assert.equal(fullRow.maxWaiting, 1);
    assert.equal(fullRow.waitingCount, 1);
    assert.equal(fullRow.full, true);

    const cleared = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ maxWaiting: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.queue.maxWaiting, null);

    const catalogAgain = await request(app).get("/api/queues");
    const openRow = catalogAgain.body.queues.find((q) => q.id === queueId);
    assert.equal(openRow.full, false);
    assert.equal(openRow.maxWaiting, null);
  });

  it("rejects join and walk-in at the cap with a clear error, and allows them below it", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    cafeteria.maxWaiting = 2;
    await cafeteria.save();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await registerUser(app, "a@example.com", "A");
    const second = await registerUser(app, "b@example.com", "B");
    const third = await registerUser(app, "c@example.com", "C");

    assert.equal(
      (await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${first}`))
        .status,
      201
    );
    assert.equal(
      (await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${second}`))
        .status,
      201
    );

    const blocked = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${third}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "This queue is full");
    assert.equal(blocked.body.maxWaiting, 2);
    assert.equal(blocked.body.waitingCount, 2);

    const walkIn = await request(app)
      .post(`/api/admin/queues/${queueId}/walk-in`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Walk-in Pat" });
    assert.equal(walkIn.status, 409);
    assert.equal(walkIn.body.error, "This queue is full");

    const active = await QueueEntry.countDocuments({
      queue: cafeteria._id,
      status: { $in: ["waiting", "serving"] },
    });
    assert.equal(active, 2);
  });

  it("counts a called (serving) entry toward the cap", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    cafeteria.maxWaiting = 1;
    await cafeteria.save();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await registerUser(app, "called@example.com", "Called");
    const second = await registerUser(app, "late@example.com", "Late");

    assert.equal(
      (await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${first}`))
        .status,
      201
    );
    const called = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({});
    assert.equal(called.status, 200);

    const blocked = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${second}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "This queue is full");
  });

  it("does not let concurrent joins exceed the cap", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    cafeteria.maxWaiting = 2;
    await cafeteria.save();
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const tokens = [];
    for (let i = 0; i < 5; i += 1) {
      tokens.push(await registerUser(app, `racer${i}@example.com`, `Racer ${i}`));
    }

    const results = await Promise.all(
      tokens.map((token) =>
        request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${token}`)
      )
    );
    const created = results.filter((res) => res.status === 201);
    const full = results.filter((res) => res.status === 409 && res.body.error === "This queue is full");
    assert.equal(created.length, 2);
    assert.equal(full.length, 3);

    const active = await QueueEntry.countDocuments({
      queue: cafeteria._id,
      status: { $in: ["waiting", "serving"] },
    });
    assert.equal(active, 2);
  });

  it("rejects a cap below current occupancy and does not evict anyone", async () => {
    await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const queueId = cafeteria._id.toString();
    const app = testApp();
    const admin = await createAdmin(app);
    const first = await registerUser(app, "cap-a@example.com", "A");
    const second = await registerUser(app, "cap-b@example.com", "B");
    assert.equal(
      (await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${first}`)).status,
      201
    );
    assert.equal(
      (await request(app).post(`/api/queues/${queueId}/join`).set("Authorization", `Bearer ${second}`)).status,
      201
    );

    const blocked = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ maxWaiting: 1 });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /already in line/i);

    const still = await QueueEntry.countDocuments({
      queue: cafeteria._id,
      status: { $in: ["waiting", "serving"] },
    });
    assert.equal(still, 2);
    const reloaded = await Queue.findById(cafeteria._id);
    assert.equal(reloaded.maxWaiting ?? null, null);

    const allowed = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ maxWaiting: 2 });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.queue.maxWaiting, 2);
  });

});
