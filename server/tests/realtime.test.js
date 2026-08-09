import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import request from "supertest";
import { io as createSocketClient } from "socket.io-client";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { createRealtimeServer } from "../src/realtime.js";
import { attachRealtime, roomForQueue } from "../src/services/realtime.js";

async function registerUser(app, email = "realtime-waiter@example.com", name = "Realtime Waiter") {
  const res = await request(app).post("/api/auth/register").send({
    email,
    password: "password123",
    name,
  });
  assert.equal(res.status, 201);
  return { token: res.body.token, user: res.body.user };
}

async function createAdmin(app, email = "realtime-admin@example.com", name = "Realtime Admin") {
  const password = "password123";
  const passwordHash = await User.hashPassword(password);
  await User.create({
    email,
    name,
    passwordHash,
    role: "admin",
  });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return { token: res.body.token, user: res.body.user };
}

async function seedAndGetQueueId(slug) {
  await seedVenueAndQueues();
  const queue = await Queue.findOne({ slug });
  assert.ok(queue);
  return queue._id.toString();
}

/** Connect a socket.io-client with the given JWT; resolves once connected or rejected. */
function connectClient(url, token) {
  const socket = createSocketClient(url, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 2000,
    auth: { token },
  });
  return new Promise((resolve) => {
    socket.once("connect", () => resolve({ socket, error: null }));
    socket.once("connect_error", (err) => resolve({ socket, error: err }));
  });
}

function subscribe(socket, queueId) {
  return new Promise((resolve) => {
    socket.emit("subscribe", { queueId }, (ack) => resolve(ack));
  });
}

/** Collect queue:changed payloads for a socket into an array. */
function collectEvents(socket) {
  const events = [];
  socket.on("queue:changed", (payload) => events.push(payload));
  return events;
}

/** Disconnect a client socket (sync in socket.io-client; rejected ones already stopped). */
function closeClient({ socket, error }) {
  if (!socket || error) return;
  socket.disconnect();
}

describe("Socket.IO realtime (integration)", () => {
  let app;
  let httpServer;
  let io;
  let url;
  let queueId;
  let admin;

  before(async () => {
    await setupTestDb();
    queueId = await seedAndGetQueueId("cafeteria");

    app = testApp();
    httpServer = createServer(app);
    io = createRealtimeServer(httpServer, { clientOrigin: true });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;

    admin = await createAdmin(app);
  });

  after(async () => {
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
    queueId = await seedAndGetQueueId("cafeteria");
    admin = await createAdmin(app);
  });

  it("rejects a connection with a missing or invalid token", async () => {
    const noToken = await connectClient(url, undefined);
    assert.ok(noToken.error, "missing token should not connect");

    const badToken = await connectClient(url, "not-a-jwt");
    assert.ok(badToken.error, "invalid token should not connect");

    closeClient(noToken);
    closeClient(badToken);
  });

  it("delivers queue:changed to subscribed clients after admin serve", async () => {
    const user = await registerUser(app);
    const join = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(join.status, 201);

    const adminSocket = await connectClient(url, admin.token);
    assert.ok(!adminSocket.error);
    const waiterSocket = await connectClient(url, user.token);
    assert.ok(!waiterSocket.error);

    const adminEvents = collectEvents(adminSocket.socket);
    const waiterEvents = collectEvents(waiterSocket.socket);

    const adminAck = await subscribe(adminSocket.socket, queueId);
    assert.deepEqual(adminAck, { ok: true });
    const waiterAck = await subscribe(waiterSocket.socket, queueId);
    assert.deepEqual(waiterAck, { ok: true });

    const serve = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(serve.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(adminEvents.length, 1);
    assert.equal(waiterEvents.length, 1);
    assert.equal(adminEvents[0].queueId, queueId);
    assert.equal(adminEvents[0].change, "served");

    closeClient(adminSocket);
    closeClient(waiterSocket);
  });

  it("emits only to the room of the changed queue", async () => {
    const gymId = await seedAndGetQueueId("gym");

    const adminSocket = await connectClient(url, admin.token);
    assert.ok(!adminSocket.error);
    const gymEvents = collectEvents(adminSocket.socket);

    await subscribe(adminSocket.socket, gymId);

    const serve = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(serve.status, 404); // empty Cafeteria list — no emit expected

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(gymEvents.length, 0, "other queue rooms must stay quiet");

    closeClient(adminSocket);
  });

  it("rejects user subscribe to a queue they are not in", async () => {
    const user = await registerUser(app);
    const gymId = await seedAndGetQueueId("gym");

    const userSocket = await connectClient(url, user.token);
    assert.ok(!userSocket.error);

    const ack = await subscribe(userSocket.socket, gymId);
    assert.equal(ack.ok, false);
    assert.ok(ack.error);

    closeClient(userSocket);
  });

  it("accepts admin subscribe to any queue without membership", async () => {
    const adminSocket = await connectClient(url, admin.token);
    assert.ok(!adminSocket.error);
    const ack = await subscribe(adminSocket.socket, queueId);
    assert.deepEqual(ack, { ok: true });
    closeClient(adminSocket);
  });
});

describe("Queue change notifications (route → emitter seam)", () => {
  /** Events captured through the fake io stub, in order. */
  let emittedEvents = [];

  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
    emittedEvents = [];
    attachRealtime({
      to: (room) => ({
        emit: (event, payload) => emittedEvents.push({ room, event, payload }),
      }),
    });
  });

  async function seedAndGetCafeteriaId() {
    const queueId = await seedAndGetQueueId("cafeteria");
    return queueId;
  }

  function lastEvent() {
    assert.equal(emittedEvents.length, 1, `expected one emit, got ${emittedEvents.length}`);
    return emittedEvents[0];
  }

  async function registerUserFor(app) {
    const res = await request(app).post("/api/auth/register").send({
      email: "seam-waiter@example.com",
      password: "password123",
      name: "Seam Waiter",
    });
    assert.equal(res.status, 201);
    return res.body.token;
  }

  async function createAdminFor(app) {
    const password = "password123";
    const passwordHash = await User.hashPassword(password);
    await User.create({
      email: "seam-admin@example.com",
      name: "Seam Admin",
      passwordHash,
      role: "admin",
    });
    const res = await request(app).post("/api/auth/login").send({
      email: "seam-admin@example.com",
      password,
    });
    assert.equal(res.status, 200);
    return res.body.token;
  }

  it("join emits queue:changed (change=join) to the queue room", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const token = await registerUserFor(app);

    const res = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 201);

    const event = lastEvent();
    assert.equal(event.room, roomForQueue(queueId));
    assert.equal(event.event, "queue:changed");
    assert.equal(event.payload.queueId, queueId);
    assert.equal(event.payload.change, "join");
  });

  it("leave emits queue:changed (change=leave)", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const token = await registerUserFor(app);
    await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${token}`);

    emittedEvents = [];
    const res = await request(app)
      .post(`/api/queues/${queueId}/leave`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);

    const event = lastEvent();
    assert.equal(event.payload.change, "leave");
    assert.equal(event.payload.queueId, queueId);
  });

  it("serve and skip emit queue:changed with their change labels", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const adminToken = await createAdminFor(app);

    const serve = await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(serve.status, 404); // nobody waiting — no emit

    const userToken = await registerUserFor(app);
    await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${userToken}`);

    emittedEvents = [];
    await request(app)
      .post(`/api/admin/queues/${queueId}/serve`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(lastEvent().payload.change, "served");

    await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${userToken}`);
    emittedEvents = [];
    await request(app)
      .post(`/api/admin/queues/${queueId}/skip`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(lastEvent().payload.change, "skipped");
  });

  it("pause and resume emit queue:changed with their change labels", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const adminToken = await createAdminFor(app);

    emittedEvents = [];
    const pause = await request(app)
      .post(`/api/admin/queues/${queueId}/pause`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(pause.status, 200);
    assert.equal(lastEvent().payload.change, "pause");

    emittedEvents = [];
    const resume = await request(app)
      .post(`/api/admin/queues/${queueId}/resume`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(resume.status, 200);
    assert.equal(lastEvent().payload.change, "resume");
  });

  it("walk-in and reset emit queue:changed with their change labels", async () => {
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const adminToken = await createAdminFor(app);

    emittedEvents = [];
    const walkIn = await request(app)
      .post(`/api/admin/queues/${queueId}/walk-in`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Counter Guest" });
    assert.equal(walkIn.status, 201);
    assert.equal(lastEvent().payload.change, "walk-in");

    emittedEvents = [];
    const reset = await request(app)
      .post(`/api/admin/queues/${queueId}/reset`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(reset.status, 200);
    assert.equal(lastEvent().payload.change, "reset");
  });

  it("stays a safe no-op when no realtime server is attached (serverless path)", async () => {
    attachRealtime(null);
    const queueId = await seedAndGetCafeteriaId();
    const app = testApp();
    const token = await registerUserFor(app);

    const join = await request(app)
      .post(`/api/queues/${queueId}/join`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(join.status, 201);
  });
});
