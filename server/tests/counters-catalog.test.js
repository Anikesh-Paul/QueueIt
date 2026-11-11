import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";

async function registerUser(app, email, name = "Waiter") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return { token: res.body.token, user: res.body.user };
}

async function createAdmin(app, email = "admin@example.com") {
  const password = "password123";
  await User.create({
    email,
    name: "Admin",
    passwordHash: await User.hashPassword(password),
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function seedCafeteria() {
  await seedVenueAndQueues();
  const cafeteria = await Queue.findOne({ slug: "cafeteria" });
  assert.ok(cafeteria);
  return cafeteria;
}

async function joinAs(app, queueId, email) {
  const { token } = await registerUser(app, email, email.split("@")[0]);
  const res = await request(app)
    .post(`/api/queues/${queueId}/join`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 201);
  return { token, join: res.body };
}

describe("Multi-counter call/serve + admin catalog", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  it("exposes a default Counter 1 on seeded queues and keeps a single-counter call exclusive", async () => {
    const cafeteria = await seedCafeteria();
    const app = testApp();
    const admin = await createAdmin(app);
    const queueId = cafeteria._id.toString();
    await joinAs(app, queueId, "a@example.com");
    await joinAs(app, queueId, "b@example.com");

    const list = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.queue.counters.length, 1);
    assert.equal(list.body.queue.counters[0].name, "Counter 1");

    const first = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.queue.nowServing, 1);
    assert.equal(first.body.queue.counters[0].nowServing, 1);

    const second = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already being called/i);
  });

  it("lets two counters call and serve at the same time; status names the counter", async () => {
    const cafeteria = await seedCafeteria();
    const app = testApp();
    const admin = await createAdmin(app);
    const queueId = cafeteria._id.toString();

    const added = await request(app)
      .post(`/api/admin/queues/${queueId}/counters`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Counter 2" });
    assert.equal(added.status, 201);
    assert.equal(added.body.queue.counters.length, 2);
    const [counter1, counter2] = added.body.queue.counters;

    const first = await joinAs(app, queueId, "one@example.com");
    const second = await joinAs(app, queueId, "two@example.com");
    await joinAs(app, queueId, "three@example.com");

    const call1 = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ counterId: counter1.id });
    assert.equal(call1.status, 200);
    assert.equal(call1.body.called.tokenNumber, 1);

    const call2 = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ counterId: counter2.id });
    assert.equal(call2.status, 200);
    assert.equal(call2.body.called.tokenNumber, 2);

    const busy = await request(app)
      .post(`/api/admin/queues/${queueId}/call`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ counterId: counter1.id });
    assert.equal(busy.status, 409);

    const status1 = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${first.token}`);
    assert.equal(status1.status, 200);
    assert.equal(status1.body.status, "serving");
    assert.equal(status1.body.servingCounterName, "Counter 1");
    assert.equal(status1.body.counters.length, 2);

    const status2 = await request(app)
      .get(`/api/queues/${queueId}/status`)
      .set("Authorization", `Bearer ${second.token}`);
    assert.equal(status2.status, 200);
    assert.equal(status2.body.servingCounterName, "Counter 2");

    const serve2 = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ counterId: counter2.id });
    assert.equal(serve2.status, 200);
    assert.equal(serve2.body.served.tokenNumber, 2);
    assert.equal(serve2.body.queue.counters.find((c) => c.id === counter2.id).nowServing, 2);

    // Counter 1 is still calling token 1.
    const waiting = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    const called = waiting.body.waiting.filter((row) => row.status === "serving");
    assert.equal(called.length, 1);
    assert.equal(called[0].tokenNumber, 1);
    assert.equal(called[0].servingCounterName, "Counter 1");
  });

  it("creates a venue and queue without re-seeding, and archive hides it from the catalog", async () => {
    await seedVenueAndQueues();
    const app = testApp();
    const admin = await createAdmin(app);
    const user = await registerUser(app, "student@example.com", "Student");

    const venueRes = await request(app)
      .post("/api/admin/venues")
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Library Annex" });
    assert.equal(venueRes.status, 201);
    assert.equal(venueRes.body.venue.name, "Library Annex");
    const venueId = venueRes.body.venue.id;

    const created = await request(app)
      .post("/api/admin/queues")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        venueId,
        name: "Holds desk",
        averageServiceTime: 4,
        counters: [{ name: "Desk 1" }, { name: "Desk 2" }],
      });
    assert.equal(created.status, 201);
    assert.equal(created.body.queue.name, "Holds desk");
    assert.equal(created.body.queue.averageServiceTime, 4);
    assert.equal(created.body.queue.archived, false);
    assert.equal(created.body.queue.counters.length, 2);
    const queueId = created.body.queue.id;

    const catalog = await request(app)
      .get("/api/queues")
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.queues.some((row) => row.id === queueId));

    const join = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(join.status, 201);

    const leave = await request(app)
      .post(`/api/queues/${queueId}/leave`)
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(leave.status, 200);

    const archived = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ archived: true, name: "Holds desk" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.queue.archived, true);

    const hidden = await request(app)
      .get("/api/queues")
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(hidden.status, 200);
    assert.ok(!hidden.body.queues.some((row) => row.id === queueId));

    const refused = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(refused.status, 404);

    const restored = await request(app)
      .patch(`/api/admin/queues/${queueId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ archived: false, averageServiceTime: 6 });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.queue.archived, false);
    assert.equal(restored.body.queue.averageServiceTime, 6);

    const adminCatalog = await request(app)
      .get("/api/admin/catalog")
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(adminCatalog.status, 200);
    const annex = adminCatalog.body.venues.find((row) => row.id === venueId);
    assert.ok(annex);
    assert.equal(annex.queues.length, 1);
    assert.equal(annex.queues[0].name, "Holds desk");
  });

  it("rejects deleting the last counter and renaming a missing one", async () => {
    const cafeteria = await seedCafeteria();
    const app = testApp();
    const admin = await createAdmin(app);
    const queueId = cafeteria._id.toString();
    const list = await request(app)
      .get(`/api/admin/queues/${queueId}/waiting-list`)
      .set("Authorization", `Bearer ${admin}`);
    const counterId = list.body.queue.counters[0].id;

    const last = await request(app)
      .delete(`/api/admin/queues/${queueId}/counters/${counterId}`)
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(last.status, 409);

    const missing = await request(app)
      .patch(`/api/admin/queues/${queueId}/counters/64b0c0ffee00000000000001`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Window A" });
    assert.equal(missing.status, 404);

    const user = await registerUser(app, "nope@example.com");
    const forbidden = await request(app)
      .post("/api/admin/venues")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ name: "Secret hall" });
    assert.equal(forbidden.status, 403);

    const venue = await Venue.findOne({ slug: "campus-hub" });
    const renamed = await request(app)
      .patch(`/api/admin/venues/${venue._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Campus Hub North" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.venue.name, "Campus Hub North");
  });
});
