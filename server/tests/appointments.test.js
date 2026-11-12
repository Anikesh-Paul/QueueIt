import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { Appointment } from "../src/models/Appointment.js";
import { setNow, resetClock } from "../src/services/clock.js";
import { fairCallOrder } from "../src/services/priorityLane.js";
import { slotsForDay } from "../src/services/appointments.js";

// Monday 16 Nov 2026, campus time (IST, +05:30).
const at = (hhmm) => new Date(`2026-11-16T${hhmm}:00+05:30`);
const iso = (hhmm) => at(hhmm).toISOString();

async function loginAs(app, email, role = "user") {
  const password = "password123";
  await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword(password), role });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function cafeteria(settings = {}) {
  await seedVenueAndQueues();
  const queue = await Queue.findOne({ slug: "cafeteria" });
  Object.assign(queue, { appointmentsEnabled: true, slotMinutes: 15, slotCapacity: 2, slotGraceMinutes: 10, ...settings });
  await queue.save();
  return queue;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("appointment slots", () => {
  let app;
  before(async () => {
    await setupTestDb();
    await Appointment.syncIndexes();
    app = testApp();
  });
  after(async () => {
    resetClock();
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    setNow(at("10:00"));
  });
  afterEach(() => resetClock());

  it("cuts slots from the service windows for a campus day", async () => {
    const queue = await cafeteria();
    const slots = slotsForDay(queue, { year: 2026, month: 11, day: 16 });
    // 11:30–14:30 and 19:00–21:00 in 15-minute slots.
    assert.equal(slots.length, 12 + 8);
    assert.equal(slots[0].start.toISOString(), iso("11:30"));
    assert.equal(slots[11].start.toISOString(), iso("14:15"));
    assert.equal(slots[12].start.toISOString(), iso("19:00"));
  });

  it("lists no slots while bookings are off", async () => {
    await cafeteria({ appointmentsEnabled: false });
    const queue = await Queue.findOne({ slug: "cafeteria" });
    const res = await request(app).get(`/api/queues/${queue._id}/slots`);
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
    assert.deepEqual(res.body.slots, []);
    assert.equal(res.body.dates.length, 7);
    assert.equal(res.body.date, "2026-11-16");
  });

  it("books within capacity, one per person, and frees the spot on cancel", async () => {
    const queue = await cafeteria();
    const guest = await request(app).post(`/api/queues/${queue._id}/appointments`).send({ start: iso("11:30") });
    assert.equal(guest.status, 401);
    const admin = await loginAs(app, "admin@example.com", "admin");
    const asAdmin = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(admin)).send({ start: iso("11:30") });
    assert.equal(asAdmin.status, 403);

    const [a, b, c] = [await loginAs(app, "a@x.com"), await loginAs(app, "b@x.com"), await loginAs(app, "c@x.com")];
    const bad = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("11:31") });
    assert.equal(bad.status, 400);
    const first = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("11:30") });
    assert.equal(first.status, 201);
    assert.equal(first.body.appointment.slotStart, iso("11:30"));
    const dup = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("11:45") });
    assert.equal(dup.status, 409);
    assert.equal((await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(b)).send({ start: iso("11:30") })).status, 201);
    const full = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(c)).send({ start: iso("11:30") });
    assert.equal(full.status, 409);
    assert.match(full.body.error, /fully booked/);

    const grid = await request(app).get(`/api/queues/${queue._id}/slots`).set(auth(a));
    const slot = grid.body.slots.find((row) => row.start === iso("11:30"));
    assert.equal(slot.state, "full");
    assert.equal(grid.body.booking.status, "booked");

    const cancel = await request(app)
      .post(`/api/queues/${queue._id}/appointments/${first.body.appointment.id}/cancel`)
      .set(auth(a));
    assert.equal(cancel.status, 200);
    assert.equal((await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(c)).send({ start: iso("11:30") })).status, 201);
  });

  it("refuses slots that have started", async () => {
    const queue = await cafeteria();
    const a = await loginAs(app, "a@x.com");
    setNow(at("11:31"));
    const res = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("11:30") });
    assert.equal(res.status, 409);
  });

  it("checks in from 15 minutes before the slot and puts the person in line", async () => {
    const queue = await cafeteria();
    const a = await loginAs(app, "a@x.com");
    const booked = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("11:30") });
    const id = booked.body.appointment.id;
    setNow(at("11:10"));
    const early = await request(app).post(`/api/queues/${queue._id}/appointments/${id}/check-in`).set(auth(a));
    assert.equal(early.status, 409);
    setNow(at("11:20"));
    const ok = await request(app).post(`/api/queues/${queue._id}/appointments/${id}/check-in`).set(auth(a));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, "waiting");
    assert.equal(ok.body.appointmentAt, iso("11:30"));
    const again = await request(app).post(`/api/queues/${queue._id}/appointments/${id}/check-in`).set(auth(a));
    assert.equal(again.status, 409);
    const mine = await request(app).get("/api/queues/appointments/mine").set(auth(a));
    assert.equal(mine.body.appointments.length, 1);
    assert.equal(mine.body.appointments[0].status, "checked-in");
    assert.ok(mine.body.appointments[0].tokenNumber >= 1);
  });

  it("alternates due bookings with walk-ins instead of letting either starve", async () => {
    const queue = await cafeteria();
    const admin = await loginAs(app, "admin@example.com", "admin");
    const walkers = [];
    for (const email of ["w1@x.com", "w2@x.com", "w3@x.com"]) {
      const token = await loginAs(app, email);
      const join = await request(app).post(`/api/queues/${queue._id}/join`).set(auth(token));
      assert.equal(join.status, 201);
      walkers.push(join.body.tokenNumber);
    }
    const bookers = [];
    for (const email of ["b1@x.com", "b2@x.com"]) {
      const token = await loginAs(app, email);
      const res = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(token)).send({ start: iso("11:30") });
      bookers.push({ token, id: res.body.appointment.id });
    }
    setNow(at("11:25"));
    const tokens = [];
    for (const b of bookers) {
      const res = await request(app).post(`/api/queues/${queue._id}/appointments/${b.id}/check-in`).set(auth(b.token));
      assert.equal(res.status, 200);
      tokens.push(res.body.tokenNumber);
    }
    // Before 11:30 the bookings wait; walk-ins keep moving.
    const before = await request(app).post(`/api/admin/queues/${queue._id}/serve`).set(auth(admin));
    assert.equal(before.body.served.tokenNumber, walkers[0]);

    setNow(at("11:31"));
    const list = await request(app).get(`/api/admin/queues/${queue._id}/waiting-list`).set(auth(admin));
    assert.deepEqual(
      list.body.waiting.map((row) => row.tokenNumber),
      [tokens[0], walkers[1], tokens[1], walkers[2]]
    );
    assert.equal(list.body.waiting[0].appointmentAt, iso("11:30"));
    const order = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await request(app).post(`/api/admin/queues/${queue._id}/serve`).set(auth(admin));
      assert.equal(res.status, 200);
      order.push(res.body.served.tokenNumber);
    }
    assert.deepEqual(order, [tokens[0], walkers[1], tokens[1], walkers[2]]);
  });

  it("marks bookings missed after the grace period and pauses repeat no-shows", async () => {
    const queue = await cafeteria();
    const a = await loginAs(app, "a@x.com");
    const first = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("11:30") });
    setNow(at("11:41"));
    const late = await request(app)
      .post(`/api/queues/${queue._id}/appointments/${first.body.appointment.id}/check-in`)
      .set(auth(a));
    assert.equal(late.status, 409);
    assert.equal((await Appointment.findById(first.body.appointment.id)).status, "missed");

    const second = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("12:00") });
    assert.equal(second.status, 201);
    setNow(at("12:11"));
    const grid = await request(app).get(`/api/queues/${queue._id}/slots`).set(auth(a));
    assert.equal(grid.body.booking, null);
    const paused = await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("13:00") });
    assert.equal(paused.status, 403);
    assert.equal(paused.body.code, "booking-paused");
  });

  it("lets staff see the day's bookings and check someone in at the desk", async () => {
    const queue = await cafeteria();
    const admin = await loginAs(app, "admin@example.com", "admin");
    const a = await loginAs(app, "a@x.com");
    await request(app).post(`/api/queues/${queue._id}/appointments`).set(auth(a)).send({ start: iso("12:00") });
    const day = await request(app).get(`/api/admin/queues/${queue._id}/appointments`).set(auth(admin));
    assert.equal(day.status, 200);
    assert.equal(day.body.appointments.length, 1);
    assert.equal(day.body.appointments[0].user.email, "a@x.com");
    const checkIn = await request(app)
      .post(`/api/admin/queues/${queue._id}/appointments/${day.body.appointments[0].id}/check-in`)
      .set(auth(admin));
    assert.equal(checkIn.status, 200);
    assert.equal(checkIn.body.appointment.status, "checked-in");
    // Checked in early with nobody else waiting: staff may still serve them.
    const serve = await request(app).post(`/api/admin/queues/${queue._id}/serve`).set(auth(admin));
    assert.equal(serve.body.served.tokenNumber, checkIn.body.appointment.tokenNumber);
  });

  it("validates booking settings on the catalog patch", async () => {
    const queue = await cafeteria({ appointmentsEnabled: false });
    const admin = await loginAs(app, "admin@example.com", "admin");
    const bad = await request(app).patch(`/api/admin/queues/${queue._id}`).set(auth(admin)).send({ slotMinutes: 2 });
    assert.equal(bad.status, 400);
    const ok = await request(app)
      .patch(`/api/admin/queues/${queue._id}`)
      .set(auth(admin))
      .send({ appointmentsEnabled: true, slotMinutes: 20, slotCapacity: 3, slotGraceMinutes: 5 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.queue.appointments, { enabled: true, slotMinutes: 20, slotCapacity: 3, graceMinutes: 5 });
  });
});

describe("fairCallOrder with bookings", () => {
  const now = new Date("2026-11-16T06:01:00Z");
  const due = new Date("2026-11-16T06:00:00Z");
  const later = new Date("2026-11-16T07:00:00Z");
  it("alternates due bookings with walk-ins and leaves early check-ins at the back", () => {
    const waiters = [
      { tokenNumber: 1, waitOrder: 1000 },
      { tokenNumber: 2, waitOrder: 2000 },
      { tokenNumber: 3, waitOrder: 3000, appointmentAt: due },
      { tokenNumber: 4, waitOrder: 4000, appointmentAt: due },
      { tokenNumber: 5, waitOrder: 5000, appointmentAt: later },
    ];
    const ordered = fairCallOrder(waiters, { priorityEveryK: 3, regularServesSincePriority: 2, walkInsSinceAppointment: 1 }, now);
    assert.deepEqual(ordered.map((row) => row.tokenNumber), [3, 1, 4, 2, 5]);
    const afterBooked = fairCallOrder(waiters, { priorityEveryK: 3, regularServesSincePriority: 2, walkInsSinceAppointment: 0 }, now);
    assert.deepEqual(afterBooked.map((row) => row.tokenNumber), [1, 3, 2, 4, 5]);
  });
});
