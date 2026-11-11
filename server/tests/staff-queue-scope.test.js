import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import request from "supertest";
import { io as createSocketClient } from "socket.io-client";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { createRealtimeServer } from "../src/realtime.js";

async function login(app, email, password) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function createAdmin(app) {
  await User.create({
    email: "admin@example.com",
    name: "Admin",
    passwordHash: await User.hashPassword("password123"),
    role: "admin",
  });
  return login(app, "admin@example.com", "password123");
}

function connectClient(url, token) {
  const socket = createSocketClient(url, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 2000,
    auth: { token },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 3000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve({ socket });
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function subscribe(socket, queueId) {
  return new Promise((resolve) => {
    socket.emit("subscribe", { queueId }, (ack) => resolve(ack));
  });
}

describe("Staff queue allow-list", () => {
  before(async () => {
    await setupTestDb();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("keeps venue-only staff on every queue in their venue", async () => {
    const { venue } = await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });
    const app = testApp();
    const admin = await createAdmin(app);

    const invited = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Hub Staff",
        email: "hub-staff@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
      });
    assert.equal(invited.status, 201);
    assert.deepEqual(invited.body.staff.staffQueueIds, []);

    const staff = await login(app, "hub-staff@example.com", "temp-pass-123");
    const catalog = await request(app)
      .get("/api/admin/catalog")
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(catalog.status, 200);
    const names = catalog.body.venues[0].queues.map((q) => q.slug).sort();
    assert.deepEqual(names, ["cafeteria", "gym"]);

    const pauseGym = await request(app)
      .post(`/api/admin/queues/${gym._id}/pause`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(pauseGym.status, 200);

    const pauseCafe = await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/pause`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(pauseCafe.status, 200);
  });

  it("hides and 403s same-venue queues that are not on the allow-list", async () => {
    const { venue } = await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });
    const app = testApp();
    const admin = await createAdmin(app);

    const invited = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-only@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
        queueIds: [cafeteria._id.toString()],
      });
    assert.equal(invited.status, 201);
    assert.deepEqual(invited.body.staff.staffQueueIds, [cafeteria._id.toString()]);

    const staff = await login(app, "cafe-only@example.com", "temp-pass-123");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${staff}`);
    assert.deepEqual(me.body.user.staffQueueIds, [cafeteria._id.toString()]);

    const catalog = await request(app)
      .get("/api/admin/catalog")
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(catalog.status, 200);
    const queues = catalog.body.venues[0].queues;
    assert.equal(queues.length, 1);
    assert.equal(queues[0].id, cafeteria._id.toString());

    const pauseCafe = await request(app)
      .post(`/api/admin/queues/${cafeteria._id}/pause`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(pauseCafe.status, 200);

    const pauseGym = await request(app)
      .post(`/api/admin/queues/${gym._id}/pause`)
      .set("Authorization", `Bearer ${staff}`)
      .send({});
    assert.equal(pauseGym.status, 403);
    assert.match(pauseGym.body.error, /queue/i);

    const create = await request(app)
      .post("/api/admin/queues")
      .set("Authorization", `Bearer ${staff}`)
      .send({ venueId: venue._id.toString(), name: "Should not exist", averageServiceTime: 3 });
    assert.equal(create.status, 403);

    const analytics = await request(app)
      .get("/api/admin/analytics")
      .set("Authorization", `Bearer ${staff}`);
    assert.equal(analytics.status, 200);
    assert.deepEqual(
      (analytics.body.queues || []).map((row) => row.id),
      [cafeteria._id.toString()]
    );
  });

  it("rejects allow-list queues from another venue and lets an admin edit the list", async () => {
    const { venue } = await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });
    const otherVenue = await Venue.create({ name: "Library Annex", slug: "library-annex" });
    const holds = await Queue.create({
      name: "Holds desk",
      slug: "holds-desk",
      venue: otherVenue._id,
      averageServiceTime: 4,
      status: "open",
      acceptingTokens: true,
      counters: [{ name: "Counter 1", nowServing: null }],
    });
    const app = testApp();
    const admin = await createAdmin(app);

    const bad = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-edit@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
        queueIds: [holds._id.toString()],
      });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /venue/i);

    const invited = await request(app)
      .post("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`)
      .send({
        name: "Cafe Staff",
        email: "cafe-edit@example.com",
        venueId: venue._id.toString(),
        temporaryPassword: "temp-pass-123",
        queueIds: [cafeteria._id.toString()],
      });
    assert.equal(invited.status, 201);
    const staffId = invited.body.staff.id;

    const listed = await request(app)
      .get("/api/admin/staff")
      .set("Authorization", `Bearer ${admin}`);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.staff.some((row) => row.id === staffId));

    const updated = await request(app)
      .patch(`/api/admin/staff/${staffId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ queueIds: [gym._id.toString()] });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.staff.staffQueueIds, [gym._id.toString()]);

    const cleared = await request(app)
      .patch(`/api/admin/staff/${staffId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ queueIds: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.staff.staffQueueIds, []);

    const staffToken = await login(app, "cafe-edit@example.com", "temp-pass-123");
    const staffList = await request(app)
      .get("/api/admin/staff")
      .set("Authorization", `Bearer ${staffToken}`);
    assert.equal(staffList.status, 403);
  });

  it("lets allow-listed staff subscribe only to permitted queues", async () => {
    const { venue } = await seedVenueAndQueues();
    const cafeteria = await Queue.findOne({ slug: "cafeteria" });
    const gym = await Queue.findOne({ slug: "gym" });
    const app = testApp();
    await createAdmin(app);
    await User.create({
      email: "cafe-socket@example.com",
      name: "Cafe Socket",
      passwordHash: await User.hashPassword("password123"),
      role: "staff",
      staffVenue: venue._id,
      staffQueues: [cafeteria._id],
    });
    const staff = await login(app, "cafe-socket@example.com", "password123");

    const httpServer = createServer(app);
    const io = createRealtimeServer(httpServer, { clientOrigin: true });
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${httpServer.address().port}`;
    const client = await connectClient(url, staff);
    try {
      const allowed = await subscribe(client.socket, cafeteria._id.toString());
      assert.equal(allowed.ok, true);
      const blocked = await subscribe(client.socket, gym._id.toString());
      assert.equal(blocked.ok, false);
      assert.match(blocked.error, /queue/i);
    } finally {
      client.socket.disconnect();
      io.close();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
