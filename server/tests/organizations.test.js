import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";

async function makeConsole(app, email, fields) {
  await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword("password123"), ...fields });
  const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
  assert.equal(res.status, 200);
  return res.body.token;
}

describe("multiple organizations", () => {
  let app;
  let admin;
  let staff;
  let cafe;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

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
    admin = await makeConsole(app, "admin@example.com", { role: "admin" });
    staff = await makeConsole(app, "riya@example.com", { role: "staff", staffVenue: cafe.venue });
  });

  async function makeAnnexWithQueue() {
    const org = await request(app).post("/api/admin/organizations").set(auth(admin)).send({ name: "City Hospital Annex" });
    assert.equal(org.status, 201);
    const venue = await request(app)
      .post("/api/admin/venues")
      .set(auth(admin))
      .send({ name: "Outpatient Block", organizationId: org.body.organization.id });
    assert.equal(venue.status, 201);
    assert.equal(venue.body.venue.organizationId, org.body.organization.id);
    const queue = await request(app).post("/api/admin/queues").set(auth(admin)).send({ venueId: venue.body.venue.id, name: "Pharmacy" });
    assert.equal(queue.status, 201);
    return { org: org.body.organization, venue: venue.body.venue, queue: queue.body.queue };
  }

  it("with one organization, everything is the main campus and nothing changes", async () => {
    const orgs = await request(app).get("/api/queues/organizations");
    assert.equal(orgs.status, 200);
    assert.deepEqual(orgs.body.organizations.map((o) => [o.id, o.slug, o.isDefault]), [["default", "main", true]]);
    assert.equal(orgs.body.organizations[0].queueCount, 2);
    const all = await request(app).get("/api/queues");
    assert.equal(all.body.queues.length, 2);
    assert.equal(all.body.queues[0].venue.organizationId, null);
  });

  it("students can list one organization's lines by slug", async () => {
    const { org } = await makeAnnexWithQueue();
    assert.equal(org.slug, "city-hospital-annex");
    const orgs = await request(app).get("/api/queues/organizations");
    assert.deepEqual(orgs.body.organizations.map((o) => o.name), ["Main campus", "City Hospital Annex"]);

    const annex = await request(app).get("/api/queues?org=city-hospital-annex");
    assert.deepEqual(annex.body.queues.map((q) => q.name), ["Pharmacy"]);
    assert.equal(annex.body.queues[0].venue.organizationId, org.id);
    const main = await request(app).get("/api/queues?org=main");
    assert.deepEqual(main.body.queues.map((q) => q.name).sort(), ["Cafeteria", "Gym"]);
    assert.equal((await request(app).get("/api/queues")).body.queues.length, 3);
    assert.equal((await request(app).get("/api/queues?org=nope")).status, 404);
  });

  it("empty organizations stay hidden from students but show for admins", async () => {
    await request(app).post("/api/admin/organizations").set(auth(admin)).send({ name: "Empty Org" });
    const pub = await request(app).get("/api/queues/organizations");
    assert.deepEqual(pub.body.organizations.map((o) => o.name), ["Main campus"]);
    const adm = await request(app).get("/api/admin/organizations").set(auth(admin));
    assert.deepEqual(adm.body.organizations.map((o) => o.name), ["Main campus", "Empty Org"]);
  });

  it("only global admins manage organizations and move venues; changes are audited", async () => {
    assert.equal((await request(app).post("/api/admin/organizations").set(auth(staff)).send({ name: "Nope" })).status, 403);
    const { org } = await makeAnnexWithQueue();
    assert.equal((await request(app).patch(`/api/admin/organizations/${org.id}`).set(auth(staff)).send({ name: "x" })).status, 403);
    assert.equal((await request(app).patch(`/api/admin/organizations/default`).set(auth(admin)).send({ name: "x" })).status, 400);
    assert.equal((await request(app).post("/api/admin/organizations").set(auth(admin)).send({ name: "  " })).status, 400);
    const renamed = await request(app).patch(`/api/admin/organizations/${org.id}`).set(auth(admin)).send({ name: "Annex" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.organization.slug, "city-hospital-annex", "slug stays stable so links keep working");

    assert.equal(
      (await request(app).patch(`/api/admin/venues/${cafe.venue}`).set(auth(staff)).send({ organizationId: org.id })).status,
      403
    );
    const moved = await request(app).patch(`/api/admin/venues/${cafe.venue}`).set(auth(admin)).send({ organizationId: org.id });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.venue.organizationId, org.id);
    assert.deepEqual(
      (await request(app).get("/api/queues?org=main")).body.queues.map((q) => q.name),
      []
    );
    assert.equal((await request(app).patch(`/api/admin/venues/${cafe.venue}`).set(auth(admin)).send({ organizationId: "zzz" })).status, 404);

    const actions = (await AdminAudit.find({}).sort({ _id: 1 })).map((a) => a.action);
    for (const a of ["org-create", "org-rename", "venue-move"]) assert.ok(actions.includes(a), a);
    const move = await AdminAudit.findOne({ action: "venue-move" });
    assert.equal(move.meta.from, "Main campus");
    assert.equal(move.meta.to, "Annex");
  });

  it("campus notices can target one organization", async () => {
    const { org, queue } = await makeAnnexWithQueue();
    const post = (body) => request(app).post("/api/admin/announcements").set(auth(admin)).send(body);
    assert.equal((await post({ scope: "campus", title: "Everyone everywhere" })).status, 201);
    assert.equal((await post({ scope: "campus", organizationId: org.id, title: "Annex only" })).status, 201);
    assert.equal((await post({ scope: "campus", organizationId: "main", title: "Main only" })).status, 201);
    assert.equal((await post({ scope: "campus", organizationId: "nope", title: "x" })).status, 404);

    const annex = await request(app).get(`/api/queues/announcements?queueId=${queue.id}`);
    assert.deepEqual(annex.body.announcements.map((a) => a.title).sort(), ["Annex only", "Everyone everywhere"]);
    const main = await request(app).get(`/api/queues/announcements?queueId=${cafe._id}`);
    assert.deepEqual(main.body.announcements.map((a) => a.title).sort(), ["Everyone everywhere", "Main only"]);
    const list = await request(app).get("/api/admin/announcements").set(auth(admin));
    const annexRow = list.body.announcements.find((a) => a.title === "Annex only");
    assert.equal(annexRow.organizationName, "City Hospital Annex");
  });
});
