import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { auditCategoryOf } from "../src/services/adminAudit.js";
import { resetClock } from "../src/services/clock.js";

async function makeConsole(app, email, fields) {
  await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword("password123"), ...fields });
  const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
  assert.equal(res.status, 200);
  return res.body.token;
}

describe("audit log page", () => {
  let app;
  let admin;
  let staff;
  let cafe;
  let gym;
  let north;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const audit = (token, qs = "") => request(app).get(`/api/admin/audit${qs}`).set(auth(token));

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
    cafe = await Queue.findOne({ slug: "cafeteria" });
    gym = await Queue.findOne({ slug: "gym" });
    north = await Venue.create({ name: "North Block", slug: "north-block" });
    admin = await makeConsole(app, "admin@example.com", { role: "admin" });
    staff = await makeConsole(app, "riya@example.com", { role: "staff", staffVenue: cafe.venue });
  });
  afterEach(() => resetClock());

  it("logs catalog, counter, staff and walk-in changes that used to go unrecorded", async () => {
    const venue = await request(app).post("/api/admin/venues").set(auth(admin)).send({ name: "Sports Complex" });
    assert.equal(venue.status, 201);
    await request(app).patch(`/api/admin/venues/${venue.body.venue.id}`).set(auth(admin)).send({ name: "Sports Centre" });
    const q = await request(app).post("/api/admin/queues").set(auth(admin)).send({ venueId: venue.body.venue.id, name: "Pool" });
    assert.equal(q.status, 201);
    await request(app).patch(`/api/admin/queues/${q.body.queue.id}`).set(auth(admin)).send({ archived: true });
    const add = await request(app).post(`/api/admin/queues/${cafe._id}/counters`).set(auth(admin)).send({ name: "Window B" });
    assert.equal(add.status, 201);
    await request(app).patch(`/api/admin/queues/${cafe._id}/counters/${add.body.counter.id}`).set(auth(admin)).send({ name: "Window C" });
    await request(app).delete(`/api/admin/queues/${cafe._id}/counters/${add.body.counter.id}`).set(auth(admin));
    const staffRow = await User.findOne({ email: "riya@example.com" });
    await request(app).patch(`/api/admin/staff/${staffRow._id}`).set(auth(admin)).send({ queueIds: [String(gym._id)] });
    await request(app).post(`/api/admin/queues/${cafe._id}/walk-in`).set(auth(admin)).send({ name: "Visitor" });

    const actions = (await AdminAudit.find({}).sort({ _id: 1 })).map((a) => a.action);
    for (const expected of [
      "venue-create", "venue-rename", "queue-create", "queue-archive",
      "counter-add", "counter-rename", "counter-remove", "staff-access", "walk-in",
    ]) {
      assert.ok(actions.includes(expected), `missing ${expected} in ${actions.join(",")}`);
    }
    assert.ok(!actions.includes("queue-update"), "archiving alone is not a settings update");
    const rename = await AdminAudit.findOne({ action: "counter-rename" });
    assert.equal(rename.meta.from, "Window B");
    assert.equal(rename.meta.to, "Window C");
    const access = await AdminAudit.findOne({ action: "staff-access" });
    assert.equal(access.meta.scope, "1 queue");
    assert.equal(auditCategoryOf("counter-add"), "settings");
    assert.equal(auditCategoryOf("made-up"), "other");
  });

  it("filters by kind, person and IST day range", async () => {
    await request(app).post(`/api/admin/queues/${cafe._id}/pause`).set(auth(staff));
    await request(app).post(`/api/admin/queues/${cafe._id}/resume`).set(auth(admin));
    await request(app).post(`/api/admin/queues/${cafe._id}/counters`).set(auth(admin)).send({ name: "Window B" });
    // 10 Nov 23:30 IST for the pause; 12 Nov 00:10 IST for the rest.
    await AdminAudit.collection.updateOne({ action: "pause" }, { $set: { createdAt: new Date("2026-11-10T18:00:00Z") } });
    await AdminAudit.collection.updateMany(
      { action: { $ne: "pause" } },
      { $set: { createdAt: new Date("2026-11-11T18:40:00Z") } }
    );

    const ops = await audit(admin, "?category=operations");
    assert.deepEqual(ops.body.events.map((e) => e.action).sort(), ["pause", "resume"]);
    const settings = await audit(admin, "?category=settings");
    assert.deepEqual(settings.body.events.map((e) => e.action), ["counter-add"]);

    const staffRow = await User.findOne({ email: "riya@example.com" });
    const byStaff = await audit(admin, `?actorId=${staffRow._id}`);
    assert.deepEqual(byStaff.body.events.map((e) => e.action), ["pause"]);

    const day = await audit(admin, "?from=2026-11-12&to=2026-11-12");
    assert.deepEqual(day.body.events.map((e) => e.action).sort(), ["counter-add", "resume"]);
    const early = await audit(admin, "?to=2026-11-10");
    assert.deepEqual(early.body.events.map((e) => e.action), ["pause"]);

    assert.equal((await audit(admin, "?category=nope")).status, 400);
    assert.equal((await audit(admin, "?from=2026-02-31")).status, 400);
    assert.equal((await audit(admin, "?from=2026-11-12&to=2026-11-10")).status, 400);

    const actors = await request(app).get("/api/admin/audit/actors").set(auth(admin));
    assert.equal(actors.status, 200);
    assert.deepEqual(actors.body.actors.map((a) => a.email).sort(), ["admin@example.com", "riya@example.com"]);
  });

  it("staff only see their venue in the list, the people filter and the CSV", async () => {
    await request(app).post(`/api/admin/queues/${cafe._id}/pause`).set(auth(staff));
    await request(app).post("/api/admin/venues").set(auth(admin)).send({ name: "Elsewhere" });
    await request(app).post("/api/admin/announcements").set(auth(admin)).send({ scope: "venue", venueId: String(north._id), title: "North" });

    const list = await audit(staff);
    assert.deepEqual(list.body.events.map((e) => e.action), ["pause"]);
    const actors = await request(app).get("/api/admin/audit/actors").set(auth(staff));
    assert.deepEqual(actors.body.actors.map((a) => a.email), ["riya@example.com"]);
    assert.equal((await audit(staff, `?venueId=${north._id}`)).status, 403);

    const csv = await request(app).get("/api/admin/audit.csv").set(auth(staff));
    assert.equal(csv.status, 200);
    assert.match(csv.headers["content-type"], /text\/csv/);
    const lines = csv.text.trim().split("\n");
    assert.equal(lines[0], "time_ist,action,kind,who,who_email,role,venue,queue,details");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /,pause,operations,riya,riya@example.com,staff,Campus Hub,Cafeteria,/);
  });

  it("CSV neutralises spreadsheet formulas and respects filters", async () => {
    await request(app).post(`/api/admin/queues/${cafe._id}/pause`).set(auth(admin));
    await AdminAudit.create({
      actor: { id: "x", name: "=HYPERLINK(\"http://evil\")", email: "x@example.com", role: "staff" },
      action: "announcement-post",
      queue: { id: String(cafe._id), name: "Cafeteria" },
      venue: { id: String(cafe.venue), name: "Campus Hub" },
      meta: { title: "+1 notice" },
    });
    const csv = await request(app).get("/api/admin/audit.csv?category=notices").set(auth(admin));
    const lines = csv.text.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /,announcement-post,notices,"'=HYPERLINK\(""http:\/\/evil""\)",/);
    assert.match(lines[1], /title=\+1 notice/);
  });
});
