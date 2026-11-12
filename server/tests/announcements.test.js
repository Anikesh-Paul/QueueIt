import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { Venue } from "../src/models/Venue.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { resetClock, setNow, advanceMs } from "../src/services/clock.js";
import { cleanAnnouncementFields, endOfCampusDay } from "../src/services/announcements.js";

async function makeConsole(app, email, fields) {
  await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword("password123"), ...fields });
  const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
  assert.equal(res.status, 200);
  return res.body.token;
}

describe("announcement board", () => {
  let app;
  let admin;
  let staff;
  let gymOnly;
  let cafe;
  let gym;
  let otherVenue;
  const post = (token, body) =>
    request(app).post("/api/admin/announcements").set("Authorization", `Bearer ${token}`).send(body);
  const live = (queueId) =>
    request(app).get(`/api/queues/announcements${queueId ? `?queueId=${queueId}` : ""}`);

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
    otherVenue = await Venue.create({ name: "North Block", slug: "north-block" });
    admin = await makeConsole(app, "admin@example.com", { role: "admin" });
    staff = await makeConsole(app, "riya@example.com", { role: "staff", staffVenue: cafe.venue });
    gymOnly = await makeConsole(app, "arjun@example.com", { role: "staff", staffVenue: gym.venue, staffQueues: [gym._id] });
  });
  afterEach(() => resetClock());

  it("defaults to info until 23:59 IST and validates text and times", () => {
    const at = new Date("2026-11-12T04:30:00Z");
    const fields = cleanAnnouncementFields({ title: "  Card machine   down " }, { at });
    assert.equal(fields.title, "Card machine down");
    assert.equal(fields.tone, "info");
    assert.equal(fields.endsAt.toISOString(), endOfCampusDay(at).toISOString());
    assert.equal(fields.endsAt.toISOString(), "2026-11-12T18:29:00.000Z");
    assert.throws(() => cleanAnnouncementFields({ title: "" }, { at }), /Add a title/);
    assert.throws(() => cleanAnnouncementFields({ title: "x".repeat(81) }, { at }), /under 80/);
    assert.throws(() => cleanAnnouncementFields({ title: "a", body: "x".repeat(281) }, { at }), /under 280/);
    assert.throws(() => cleanAnnouncementFields({ title: "a", tone: "loud" }, { at }), /Info, Delay or Closure/);
    assert.throws(
      () => cleanAnnouncementFields({ title: "a", endsAt: "2026-11-20T04:30:00Z" }, { at }),
      /at most 7 days/
    );
    assert.throws(
      () => cleanAnnouncementFields({ title: "a", startsAt: "2026-11-12T08:00:00Z", endsAt: "2026-11-12T07:00:00Z" }, { at }),
      /after the start/
    );
  });

  it("students see campus, venue and queue notices that apply to their queue", async () => {
    assert.equal((await post(admin, { scope: "campus", title: "Campus closes at 6 today" })).status, 201);
    assert.equal((await post(staff, { scope: "venue", tone: "delay", title: "Hub lifts out of service" })).status, 201);
    const q = await post(staff, { scope: "queue", queueId: String(cafe._id), tone: "closure", title: "Cafeteria counter 2 closed", body: "Use counter 1." });
    assert.equal(q.status, 201);
    assert.equal(q.body.announcement.scope, "queue");
    assert.equal(q.body.announcement.queueId, String(cafe._id));
    assert.equal((await post(admin, { scope: "venue", venueId: String(otherVenue._id), title: "North Block notice" })).status, 201);

    const forCafe = await live(String(cafe._id));
    assert.equal(forCafe.status, 200);
    assert.deepEqual(forCafe.body.announcements.map((a) => a.title).sort(), [
      "Cafeteria counter 2 closed",
      "Campus closes at 6 today",
      "Hub lifts out of service",
    ]);
    const forGym = await live(String(gym._id));
    assert.deepEqual(forGym.body.announcements.map((a) => a.title).sort(), ["Campus closes at 6 today", "Hub lifts out of service"]);
    assert.equal((await live()).body.announcements.length, 4);
    assert.equal((await live("not-an-id")).body.announcements.length, 0);
  });

  it("scheduled notices wait for their start and drop off after their end", async () => {
    const res = await post(staff, {
      scope: "queue",
      queueId: String(cafe._id),
      title: "Lunch rush from 12:30",
      startsAt: "2026-11-12T07:00:00Z",
      endsAt: "2026-11-12T08:00:00Z",
    });
    assert.equal(res.status, 201);
    assert.equal((await live(String(cafe._id))).body.announcements.length, 0);
    const consoleList = await request(app).get("/api/admin/announcements").set("Authorization", `Bearer ${staff}`);
    assert.equal(consoleList.body.announcements[0].state, "scheduled");
    assert.equal(consoleList.body.announcements[0].queueName, "Cafeteria");
    advanceMs(3 * 60 * 60 * 1000); // 13:00 IST
    assert.equal((await live(String(cafe._id))).body.announcements.length, 1);
    advanceMs(60 * 60 * 1000); // 14:00 IST
    assert.equal((await live(String(cafe._id))).body.announcements.length, 0);
  });

  it("staff can only post where they have access; campus is admin-only", async () => {
    assert.equal((await post(staff, { scope: "campus", title: "x" })).status, 403);
    assert.equal((await post(staff, { scope: "venue", venueId: String(otherVenue._id), title: "x" })).status, 403);
    assert.equal((await post(gymOnly, { scope: "queue", queueId: String(cafe._id), title: "x" })).status, 403);
    assert.equal((await post(gymOnly, { scope: "queue", queueId: String(gym._id), title: "Gym mats being cleaned" })).status, 201);
    assert.equal((await post(staff, { scope: "nowhere", title: "x" })).status, 400);
    const student = await request(app).post("/api/auth/register").send({ email: "s@example.com", password: "password123", name: "S" });
    assert.equal((await post(student.body.token, { scope: "queue", queueId: String(cafe._id), title: "x" })).status, 403);
  });

  it("edit and end early, with audit entries; others can't touch it", async () => {
    const res = await post(staff, { scope: "queue", queueId: String(cafe._id), tone: "delay", title: "Running 10 min late" });
    const id = res.body.announcement.id;
    const edit = await request(app)
      .patch(`/api/admin/announcements/${id}`)
      .set("Authorization", `Bearer ${staff}`)
      .send({ title: "Running 20 min late", body: "Printer jam." });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.announcement.title, "Running 20 min late");
    assert.equal((await request(app).patch(`/api/admin/announcements/${id}`).set("Authorization", `Bearer ${gymOnly}`).send({ title: "no" })).status, 403);

    const end = await request(app).post(`/api/admin/announcements/${id}/end`).set("Authorization", `Bearer ${staff}`);
    assert.equal(end.status, 200);
    assert.equal((await live(String(cafe._id))).body.announcements.length, 0);
    assert.equal((await request(app).patch(`/api/admin/announcements/${id}`).set("Authorization", `Bearer ${staff}`).send({ title: "again" })).status, 409);

    const audit = await AdminAudit.find({}).sort({ createdAt: 1, _id: 1 });
    assert.deepEqual(audit.map((a) => a.action), ["announcement-post", "announcement-edit", "announcement-end"]);
    assert.equal(audit[0].queue.name, "Cafeteria");
    assert.equal(audit[0].meta.tone, "delay");
    assert.equal(audit[1].meta.changed, "body, title");

    const list = await request(app).get("/api/admin/announcements").set("Authorization", `Bearer ${staff}`);
    assert.equal(list.body.announcements[0].state, "ended");
    assert.equal(list.body.announcements[0].canManage, true);
  });

  it("staff see campus notices read-only and not other venues' notices", async () => {
    await post(admin, { scope: "campus", title: "Campus notice" });
    await post(admin, { scope: "venue", venueId: String(otherVenue._id), title: "North only" });
    const list = await request(app).get("/api/admin/announcements").set("Authorization", `Bearer ${staff}`);
    assert.deepEqual(list.body.announcements.map((a) => [a.title, a.canManage]), [["Campus notice", false]]);
  });
});
