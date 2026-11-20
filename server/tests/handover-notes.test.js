import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { HandoverNote } from "../src/models/HandoverNote.js";
import { resetClock, setNow, advanceMs } from "../src/services/clock.js";
import {
  DEFAULT_EXPIRY_HOURS,
  applyHandoverSettings,
  handoverExpiryHoursOf,
  notePreview,
  sanitizeNoteBody,
} from "../src/services/handoverNotes.js";

const PASSWORD = "password123";

async function makeConsole(app, email, fields) {
  await User.create({
    email,
    name: email.split("@")[0],
    passwordHash: await User.hashPassword(PASSWORD),
    ...fields,
  });
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

describe("handover notes", () => {
  let app;
  let admin;
  let staff;
  let gymOnly;
  let cafe;
  let gym;
  let cafeCounter;

  before(async () => {
    await setupTestDb();
    app = testApp();
  });
  after(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    setNow("2026-11-12T04:30:00Z"); // 10:00 IST
    await resetDb();
    await seedVenueAndQueues();
    cafe = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    if (!cafe.counters?.length) {
      cafe.counters = [{ name: "Counter 1", nowServing: null, state: "closed" }];
      await cafe.save();
    }
    cafe = await Queue.findById(cafe._id);
    cafeCounter = cafe.counters[0];
    admin = await makeConsole(app, "admin@example.com", { role: "admin" });
    staff = await makeConsole(app, "riya@example.com", { role: "staff", staffVenue: cafe.venue });
    gymOnly = await makeConsole(app, "arjun@example.com", {
      role: "staff",
      staffVenue: gym.venue,
      staffQueues: [gym._id],
    });
  });
  afterEach(() => resetClock());

  it("sanitizes text, caps at 500 characters and defaults expiry to 24 hours", () => {
    assert.equal(sanitizeNoteBody("  Printer   jammed \n\n\nsee Ravi  "), "Printer jammed\n\nsee Ravi");
    assert.equal(sanitizeNoteBody("Hello <b>world</b> & more"), "Hello world & more");
    assert.throws(() => sanitizeNoteBody("   "), /Write a short note/);
    assert.throws(() => sanitizeNoteBody("<script></script>"), /Write a short note/);
    assert.throws(() => sanitizeNoteBody("x".repeat(501)), /under 500/);
    assert.equal(handoverExpiryHoursOf({}), DEFAULT_EXPIRY_HOURS);
    assert.equal(handoverExpiryHoursOf({ handoverExpiryHours: 8 }), 8);
    const queue = { handoverExpiryHours: 24 };
    assert.deepEqual(applyHandoverSettings(queue, { handoverExpiryHours: 48 }), {});
    assert.equal(queue.handoverExpiryHours, 48);
    assert.match(applyHandoverSettings(queue, { handoverExpiryHours: 0 }).error, /1 to 168/);
    assert.equal(notePreview("a".repeat(200)).endsWith("…"), true);
  });

  it("staff can post a note on their queue, pin it, flag it and resolve it", async () => {
    const created = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "Printer jammed", important: true, pinned: true, counterId: String(cafeCounter._id) });
    assert.equal(created.status, 201);
    assert.equal(created.body.note.body, "Printer jammed");
    assert.equal(created.body.note.important, true);
    assert.equal(created.body.note.pinned, true);
    assert.equal(created.body.note.counterName, cafeCounter.name);
    assert.equal(created.body.note.state, "active");
    assert.equal(created.body.handover.expiryHours, 24);
    const expires = new Date(created.body.note.expiresAt).getTime();
    assert.equal(expires, new Date("2026-11-13T04:30:00Z").getTime());

    const id = created.body.note.id;
    const unpin = await request(app)
      .patch(`/api/admin/queues/${cafe._id}/notes/${id}`)
      .set(auth(staff))
      .send({ pinned: false, important: false });
    assert.equal(unpin.status, 200);
    assert.equal(unpin.body.note.pinned, false);
    assert.equal(unpin.body.note.important, false);

    const resolved = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes/${id}/resolve`)
      .set(auth(staff));
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.note.state, "resolved");
    assert.equal(resolved.body.note.resolvedBy.name, "riya");

    const actions = (await AdminAudit.find().sort({ createdAt: 1 })).map((row) => row.action);
    assert.deepEqual(actions, ["handover-create", "handover-unpin", "handover-unflag", "handover-resolve"]);
  });

  it("rejects empty or oversized notes and unknown counters", async () => {
    const empty = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "   " });
    assert.equal(empty.status, 400);
    const huge = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "n".repeat(501) });
    assert.equal(huge.status, 400);
    const badCounter = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "ok", counterId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
    assert.equal(badCounter.status, 404);
  });

  it("uses the queue default expiry unless the note sets its own, and hides expired notes from the active list", async () => {
    const saved = await request(app)
      .patch(`/api/admin/queues/${cafe._id}`)
      .set(auth(admin))
      .send({ handoverExpiryHours: 4 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.queue.handoverExpiryHours, 4);

    const short = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "Back in 4 hours" });
    assert.equal(short.status, 201);
    assert.equal(short.body.note.expiryHours, 4);
    const custom = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "Until Monday", expiresInHours: 72 });
    assert.equal(custom.status, 201);
    assert.equal(custom.body.note.expiryHours, 72);
    assert.equal(custom.body.notes.filter((n) => n.state === "active").length, 2);

    advanceMs(5 * 60 * 60 * 1000);
    const later = await request(app).get(`/api/admin/queues/${cafe._id}/notes`).set(auth(staff));
    assert.equal(later.status, 200);
    const shortRow = later.body.notes.find((n) => n.body === "Back in 4 hours");
    const longRow = later.body.notes.find((n) => n.body === "Until Monday");
    assert.equal(shortRow.state, "expired");
    assert.equal(longRow.state, "active");
  });

  it("ending a shift can leave a note; starting again shows it until it is acknowledged", async () => {
    const start = await request(app)
      .post(`/api/admin/queues/${cafe._id}/counters/${cafeCounter._id}/shift`)
      .set(auth(staff))
      .send({ action: "start" });
    assert.equal(start.status, 200);
    assert.equal(start.body.board.me.counter.name, cafeCounter.name);
    assert.deepEqual(start.body.board.unreadNotes, []);

    const badEnd = await request(app)
      .post(`/api/admin/queues/${cafe._id}/counters/${cafeCounter._id}/shift`)
      .set(auth(staff))
      .send({ action: "end", note: "   " });
    assert.equal(badEnd.status, 400);
    assert.equal(badEnd.body.code, "note-empty");
    const stillOn = await request(app).get("/api/admin/shifts").set(auth(staff));
    assert.equal(stillOn.body.me.counter.name, cafeCounter.name);
    assert.equal(await HandoverNote.countDocuments({}), 0);

    const end = await request(app)
      .post(`/api/admin/queues/${cafe._id}/counters/${cafeCounter._id}/shift`)
      .set(auth(staff))
      .send({ action: "end", note: "Ravi covering until 2", important: true });
    assert.equal(end.status, 200);
    assert.equal(end.body.board.me, null);
    assert.ok(end.body.note.id);

    const again = await request(app)
      .post(`/api/admin/queues/${cafe._id}/counters/${cafeCounter._id}/shift`)
      .set(auth(staff))
      .send({ action: "start" });
    assert.equal(again.status, 200);
    assert.equal(again.body.board.unreadNotes.length, 1);
    assert.equal(again.body.board.unreadNotes[0].body, "Ravi covering until 2");
    assert.equal(again.body.board.unreadNotes[0].important, true);
    assert.equal(again.body.board.unreadNotes[0].acknowledged, false);
    const cafRow = again.body.board.queues.find((q) => q.id === String(cafe._id));
    assert.equal(cafRow.activeNotes, 1);

    const noteId = again.body.board.unreadNotes[0].id;
    const ack = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes/${noteId}/ack`)
      .set(auth(staff));
    assert.equal(ack.status, 200);
    assert.equal(ack.body.note.acknowledged, true);

    const board = await request(app).get("/api/admin/shifts").set(auth(staff));
    assert.deepEqual(board.body.unreadNotes, []);

    const actions = (await AdminAudit.find({ action: { $in: ["shift-end", "handover-create", "handover-ack"] } })
      .sort({ createdAt: 1 }))
      .map((row) => row.action);
    assert.deepEqual(actions, ["shift-end", "handover-create", "handover-ack"]);
  });

  it("staff and org admins cannot read or write notes on queues outside their scope", async () => {
    const posted = await request(app)
      .post(`/api/admin/queues/${cafe._id}/notes`)
      .set(auth(staff))
      .send({ body: "Cafeteria only" });
    assert.equal(posted.status, 201);
    const noteId = posted.body.note.id;

    assert.equal(
      (await request(app).get(`/api/admin/queues/${cafe._id}/notes`).set(auth(gymOnly))).status,
      403
    );
    assert.equal(
      (await request(app).post(`/api/admin/queues/${cafe._id}/notes`).set(auth(gymOnly)).send({ body: "nope" })).status,
      403
    );
    assert.equal(
      (await request(app).post(`/api/admin/queues/${cafe._id}/notes/${noteId}/ack`).set(auth(gymOnly))).status,
      403
    );
    assert.equal(await HandoverNote.countDocuments({ body: "nope" }), 0);

    const org = await request(app).post("/api/admin/organizations").set(auth(admin)).send({ name: "City Annex" });
    assert.equal(org.status, 201);
    const venue = await request(app)
      .post("/api/admin/venues")
      .set(auth(admin))
      .send({ name: "Outpatient Block", organizationId: org.body.organization.id });
    const queue = await request(app)
      .post("/api/admin/queues")
      .set(auth(admin))
      .send({ venueId: venue.body.venue.id, name: "Pharmacy" });
    assert.equal(queue.status, 201);
    const orgAdmin = await makeConsole(app, "annex@example.com", {
      role: "admin",
      adminOrganizations: [org.body.organization.id],
    });
    assert.equal(
      (await request(app).get(`/api/admin/queues/${cafe._id}/notes`).set(auth(orgAdmin))).status,
      403
    );
    assert.equal(
      (await request(app).post(`/api/admin/queues/${cafe._id}/notes`).set(auth(orgAdmin)).send({ body: "cross" })).status,
      403
    );
    const own = await request(app)
      .post(`/api/admin/queues/${queue.body.queue.id}/notes`)
      .set(auth(orgAdmin))
      .send({ body: "Pharmacy printer down" });
    assert.equal(own.status, 201);
    assert.equal(own.body.note.body, "Pharmacy printer down");
  });
});
