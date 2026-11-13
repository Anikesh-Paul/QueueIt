import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import request from "supertest";
import { io as createSocketClient } from "socket.io-client";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { seedVenueAndQueues } from "../src/seed.js";
import { Queue } from "../src/models/Queue.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { Announcement } from "../src/models/Announcement.js";
import adminRouter from "../src/routes/admin.js";
import { createRealtimeServer } from "../src/realtime.js";
import { canAccessVenue, isGlobalAdmin, isOrgAdmin, loadAccessScope, scopedVenueIds } from "../src/services/staffAccess.js";

const PASSWORD = "password123";
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function login(app, email) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function makeUser(app, email, fields) {
  const user = await User.create({ email, name: email.split("@")[0], passwordHash: await User.hashPassword(PASSWORD), ...fields });
  return { user, token: await login(app, email) };
}

/** Every route on the admin router, with path params filled in. */
function adminRoutes() {
  const out = [];
  for (const layer of adminRouter.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) out.push({ method, path: layer.route.path });
  }
  return out;
}

describe("organization-scoped admins", () => {
  let app;
  let global; // { user, token }
  let cafe;
  let gym;
  let mainVenueId;
  let annex; // { org, venue, queue }
  let orgAdmin; // { user, token }
  let mainStaff;

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
    mainVenueId = String(cafe.venue);
    global = await makeUser(app, "global@example.com", { role: "admin" });
    mainStaff = await makeUser(app, "riya@example.com", { role: "staff", staffVenue: cafe.venue });

    const org = await request(app).post("/api/admin/organizations").set(auth(global.token)).send({ name: "City Annex" });
    const venue = await request(app)
      .post("/api/admin/venues")
      .set(auth(global.token))
      .send({ name: "Outpatient Block", organizationId: org.body.organization.id });
    const queue = await request(app).post("/api/admin/queues").set(auth(global.token)).send({ venueId: venue.body.venue.id, name: "Pharmacy" });
    assert.equal(queue.status, 201);
    annex = { org: org.body.organization, venue: venue.body.venue, queue: queue.body.queue };

    const invited = await request(app)
      .post("/api/admin/admins")
      .set(auth(global.token))
      .send({ name: "Annex Admin", email: "annex-admin@example.com", temporaryPassword: PASSWORD, organizationIds: [annex.org.id] });
    assert.equal(invited.status, 201, JSON.stringify(invited.body));
    assert.deepEqual(invited.body.admin.adminOrganizationIds, [annex.org.id]);
    orgAdmin = { user: await User.findById(invited.body.admin.id), token: await login(app, "annex-admin@example.com") };
  });

  it("existing admins stay global, including records saved before the field existed", async () => {
    const ping = await request(app).get("/api/admin/ping").set(auth(global.token));
    assert.equal(ping.body.scope, "global");
    const me = await request(app).get("/api/auth/me").set(auth(global.token));
    assert.equal(me.body.user.adminOrganizationIds, null);

    // A legacy document with no adminOrganizations key at all.
    await User.collection.insertOne({
      email: "legacy@example.com",
      name: "Legacy",
      passwordHash: await User.hashPassword(PASSWORD),
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const legacy = await login(app, "legacy@example.com");
    assert.equal((await request(app).get("/api/admin/ping").set(auth(legacy))).body.scope, "global");
    const catalog = await request(app).get("/api/admin/catalog").set(auth(legacy));
    assert.equal(catalog.body.venues.length, 2);
    const people = await request(app).get("/api/admin/people").set(auth(legacy));
    assert.equal(people.status, 200);
    assert.equal(people.body.people.find((p) => p.email === "legacy@example.com").scope, "global");
  });

  it("an organization admin sees only their organization's venues, queues and organizations", async () => {
    const ping = await request(app).get("/api/admin/ping").set(auth(orgAdmin.token));
    assert.equal(ping.body.scope, "organizations");
    const catalog = await request(app).get("/api/admin/catalog").set(auth(orgAdmin.token));
    assert.deepEqual(catalog.body.venues.map((v) => v.name), ["Outpatient Block"]);
    assert.deepEqual(catalog.body.venues[0].queues.map((q) => q.name), ["Pharmacy"]);
    const orgs = await request(app).get("/api/admin/organizations").set(auth(orgAdmin.token));
    assert.deepEqual(orgs.body.organizations.map((o) => o.name), ["City Annex"]);
    // Staff see only their venue's organization.
    const staffOrgs = await request(app).get("/api/admin/organizations").set(auth(mainStaff.token));
    assert.deepEqual(staffOrgs.body.organizations.map((o) => o.id), ["default"]);
    // Own queue works.
    const own = await request(app).get(`/api/admin/queues/${annex.queue.id}/waiting-list`).set(auth(orgAdmin.token));
    assert.equal(own.status, 200);
  });

  it("every queue route refuses another organization's queue (403/404), never 2xx", async () => {
    const counterId = String(cafe.counters?.[0]?._id ?? new mongoose.Types.ObjectId());
    const fake = String(new mongoose.Types.ObjectId());
    const routes = adminRoutes().filter((r) => r.path.includes(":queueId"));
    assert.ok(routes.length >= 20, `expected many queue routes, got ${routes.length}`);
    const before = await Queue.findById(cafe._id).lean();
    for (const { method, path } of routes) {
      const url = `/api/admin${path}`
        .replace(":queueId", String(cafe._id))
        .replace(":counterId", counterId)
        .replace(":entryId", fake)
        .replace(":appointmentId", fake);
      const res = await request(app)[method](url).set(auth(orgAdmin.token)).send({ action: "start", name: "X", status: "paused" });
      assert.ok([403, 404].includes(res.status), `${method.toUpperCase()} ${path} → ${res.status}`);
    }
    const afterDoc = await Queue.findById(cafe._id).lean();
    assert.equal(afterDoc.status, before.status);
    assert.equal(afterDoc.name, before.name);
    assert.equal(afterDoc.counters.length, before.counters.length);
  });

  it("venue and queue settings are limited to their organizations", async () => {
    const renameMain = await request(app).patch(`/api/admin/venues/${mainVenueId}`).set(auth(orgAdmin.token)).send({ name: "Mine now" });
    assert.equal(renameMain.status, 403);
    const queueInMain = await request(app).post("/api/admin/queues").set(auth(orgAdmin.token)).send({ venueId: mainVenueId, name: "Sneaky" });
    assert.equal(queueInMain.status, 403);
    const venueInMain = await request(app).post("/api/admin/venues").set(auth(orgAdmin.token)).send({ name: "Sneaky", organizationId: "default" });
    assert.equal(venueInMain.status, 403);
    // No organization given → their only one.
    const venue = await request(app).post("/api/admin/venues").set(auth(orgAdmin.token)).send({ name: "Lab Block" });
    assert.equal(venue.status, 201);
    assert.equal(venue.body.venue.organizationId, annex.org.id);
    const queue = await request(app).post("/api/admin/queues").set(auth(orgAdmin.token)).send({ venueId: venue.body.venue.id, name: "Blood test" });
    assert.equal(queue.status, 201);
    const rename = await request(app).patch(`/api/admin/venues/${annex.venue.id}`).set(auth(orgAdmin.token)).send({ name: "OPD Block" });
    assert.equal(rename.status, 200);
    // Moving venues between organizations stays with global admins.
    const move = await request(app).patch(`/api/admin/venues/${annex.venue.id}`).set(auth(orgAdmin.token)).send({ organizationId: "default" });
    assert.equal(move.status, 403);
  });

  it("analytics and reports only cover their organizations", async () => {
    const campus = await request(app).get("/api/admin/analytics").set(auth(orgAdmin.token));
    assert.equal(campus.status, 200);
    const names = JSON.stringify(campus.body);
    assert.ok(names.includes("Pharmacy"));
    assert.ok(!names.includes("Cafeteria") && !names.includes("Gym"), "no main-campus queues");
    assert.equal((await request(app).get(`/api/admin/analytics?venueId=${mainVenueId}`).set(auth(orgAdmin.token))).status, 403);
    assert.equal((await request(app).get(`/api/admin/analytics.csv?venueId=${mainVenueId}`).set(auth(orgAdmin.token))).status, 403);

    const report = await request(app).get("/api/admin/analytics/report").set(auth(orgAdmin.token));
    assert.equal(report.status, 200);
    assert.ok(!JSON.stringify(report.body).includes("Cafeteria"));
    assert.equal((await request(app).get(`/api/admin/analytics/report?venueId=${mainVenueId}`).set(auth(orgAdmin.token))).status, 403);
    assert.equal((await request(app).get(`/api/admin/analytics/report?queueId=${cafe._id}`).set(auth(orgAdmin.token))).status, 403);
    assert.equal((await request(app).get(`/api/admin/analytics/report.csv?queueId=${gym._id}`).set(auth(orgAdmin.token))).status, 403);
    // Global admin still sees everything.
    const all = await request(app).get("/api/admin/analytics").set(auth(global.token));
    assert.ok(JSON.stringify(all.body).includes("Cafeteria"));
  });

  it("the audit log shows only their organizations' entries", async () => {
    await request(app).post(`/api/admin/queues/${cafe._id}/pause`).set(auth(global.token));
    await request(app).post(`/api/admin/queues/${annex.queue.id}/pause`).set(auth(orgAdmin.token));
    const log = await request(app).get("/api/admin/audit").set(auth(orgAdmin.token));
    assert.equal(log.status, 200);
    assert.ok(log.body.events.length > 0);
    assert.ok(log.body.events.every((e) => e.venue?.id === annex.venue.id), JSON.stringify(log.body.events.map((e) => [e.action, e.venue])));
    // Organization-level and assignment entries (no venue) are global-only.
    assert.ok(!log.body.events.some((e) => ["org-create", "admin-invite"].includes(e.action)));
    assert.equal((await request(app).get(`/api/admin/audit?venueId=${mainVenueId}`).set(auth(orgAdmin.token))).status, 403);
    assert.equal((await request(app).get(`/api/admin/audit?queueId=${cafe._id}`).set(auth(orgAdmin.token))).status, 403);
    assert.equal((await request(app).get(`/api/admin/audit.csv?venueId=${mainVenueId}`).set(auth(orgAdmin.token))).status, 403);
    const csv = await request(app).get("/api/admin/audit.csv").set(auth(orgAdmin.token));
    assert.ok(!csv.text.includes("Cafeteria"));
    const actors = await request(app).get("/api/admin/audit/actors").set(auth(orgAdmin.token));
    // The global admin set the annex up, so they appear; main-campus-only actors don't.
    assert.deepEqual(actors.body.actors.map((a) => a.email).sort(), ["annex-admin@example.com", "global@example.com"]);
    await request(app).post(`/api/admin/queues/${gym._id}/pause`).set(auth(mainStaff.token));
    const after = await request(app).get("/api/admin/audit/actors").set(auth(orgAdmin.token));
    assert.ok(!after.body.actors.some((a) => a.email === "riya@example.com"));
  });

  it("announcements: own venues and organization only", async () => {
    const mainVenueNotice = await request(app)
      .post("/api/admin/announcements")
      .set(auth(orgAdmin.token))
      .send({ scope: "venue", venueId: mainVenueId, title: "Hi", tone: "info" });
    assert.equal(mainVenueNotice.status, 403);
    const mainQueueNotice = await request(app)
      .post("/api/admin/announcements")
      .set(auth(orgAdmin.token))
      .send({ scope: "queue", queueId: String(cafe._id), title: "Hi", tone: "info" });
    assert.equal(mainQueueNotice.status, 403);
    const toMain = await request(app)
      .post("/api/admin/announcements")
      .set(auth(orgAdmin.token))
      .send({ scope: "campus", organizationId: "default", title: "Hi", tone: "info" });
    assert.equal(toMain.status, 403);
    const orgWide = await request(app).post("/api/admin/announcements").set(auth(orgAdmin.token)).send({ scope: "campus", title: "Annex closed early", tone: "closure" });
    assert.equal(orgWide.status, 201);
    assert.equal(orgWide.body.announcement.organizationId, annex.org.id);

    const globalMain = await request(app)
      .post("/api/admin/announcements")
      .set(auth(global.token))
      .send({ scope: "venue", venueId: mainVenueId, title: "Main only", tone: "info" });
    assert.equal(globalMain.status, 201);
    const mainOrg = await request(app)
      .post("/api/admin/announcements")
      .set(auth(global.token))
      .send({ scope: "campus", organizationId: "default", title: "Main campus wide", tone: "info" });
    assert.equal(mainOrg.status, 201);
    const edit = await request(app)
      .patch(`/api/admin/announcements/${globalMain.body.announcement.id}`)
      .set(auth(orgAdmin.token))
      .send({ title: "Hijacked" });
    assert.equal(edit.status, 403);
    assert.equal((await request(app).post(`/api/admin/announcements/${mainOrg.body.announcement.id}/end`).set(auth(orgAdmin.token))).status, 403);
    const list = await request(app).get("/api/admin/announcements").set(auth(orgAdmin.token));
    const titles = list.body.announcements.map((a) => a.title);
    assert.ok(titles.includes("Annex closed early"));
    assert.ok(!titles.includes("Main only") && !titles.includes("Main campus wide"), titles.join(","));
    assert.equal((await Announcement.findById(globalMain.body.announcement.id)).title, "Main only");
  });

  it("shifts: board and actions only inside their organizations", async () => {
    const board = await request(app).get("/api/admin/shifts").set(auth(orgAdmin.token));
    assert.equal(board.status, 200);
    const text = JSON.stringify(board.body);
    assert.ok(text.includes("Pharmacy") && !text.includes("Cafeteria") && !text.includes("Gym"));
  });

  it("staff: list, invite, update and move only inside their organizations", async () => {
    const list = await request(app).get("/api/admin/staff").set(auth(orgAdmin.token));
    assert.equal(list.status, 200);
    assert.equal(list.body.staff.length, 0);
    const toMain = await request(app)
      .post("/api/admin/staff")
      .set(auth(orgAdmin.token))
      .send({ name: "Sneaky", email: "sneaky@example.com", venueId: mainVenueId, temporaryPassword: PASSWORD });
    assert.equal(toMain.status, 403);
    assert.equal(await User.exists({ email: "sneaky@example.com" }), null);
    const editMain = await request(app).patch(`/api/admin/staff/${mainStaff.user._id}`).set(auth(orgAdmin.token)).send({ queueIds: [] });
    assert.equal(editMain.status, 404);
    const invited = await request(app)
      .post("/api/admin/staff")
      .set(auth(orgAdmin.token))
      .send({ name: "Annex Staff", email: "annex-staff@example.com", venueId: annex.venue.id, temporaryPassword: PASSWORD });
    assert.equal(invited.status, 201);
    const moveOut = await request(app).patch(`/api/admin/staff/${invited.body.staff.id}`).set(auth(orgAdmin.token)).send({ venueId: mainVenueId });
    assert.equal(moveOut.status, 403);
    const list2 = await request(app).get("/api/admin/staff").set(auth(orgAdmin.token));
    assert.deepEqual(list2.body.staff.map((s) => s.email), ["annex-staff@example.com"]);
    // Staff themselves still can't manage staff.
    assert.equal((await request(app).get("/api/admin/staff").set(auth(mainStaff.token))).status, 403);
  });

  it("organizations and assignments are global-admin only", async () => {
    const t = auth(orgAdmin.token);
    assert.equal((await request(app).get("/api/admin/people").set(t)).status, 403);
    assert.equal((await request(app).patch(`/api/admin/people/${orgAdmin.user._id}/organizations`).set(t).send({ organizationIds: [] })).status, 403);
    assert.equal((await request(app).patch(`/api/admin/people/${global.user._id}/organizations`).set(t).send({ organizationIds: [annex.org.id] })).status, 403);
    assert.equal((await request(app).post("/api/admin/admins").set(t).send({ name: "X", email: "x@example.com", organizationIds: [annex.org.id] })).status, 403);
    assert.equal((await request(app).post("/api/admin/organizations").set(t).send({ name: "Mine" })).status, 403);
    assert.equal((await request(app).patch(`/api/admin/organizations/${annex.org.id}`).set(t).send({ name: "Renamed" })).status, 403);
    assert.equal((await request(app).get("/api/admin/people").set(auth(mainStaff.token))).status, 403);
    assert.deepEqual((await User.findById(orgAdmin.user._id)).adminOrganizations, [annex.org.id]);
  });

  it("assignment changes take effect immediately and are audited", async () => {
    const t = auth(global.token);
    // Add the main campus too: the same token now reaches the cafeteria.
    const widen = await request(app)
      .patch(`/api/admin/people/${orgAdmin.user._id}/organizations`)
      .set(t)
      .send({ organizationIds: [annex.org.id, "main"] });
    assert.equal(widen.status, 200);
    assert.deepEqual(widen.body.admin.adminOrganizationIds, [annex.org.id, "default"]);
    assert.equal((await request(app).get(`/api/admin/queues/${cafe._id}/waiting-list`).set(auth(orgAdmin.token))).status, 200);

    // Back to only the annex: refused again with the same token.
    await request(app).patch(`/api/admin/people/${orgAdmin.user._id}/organizations`).set(t).send({ organizationIds: [annex.org.id] });
    assert.equal((await request(app).get(`/api/admin/queues/${cafe._id}/waiting-list`).set(auth(orgAdmin.token))).status, 403);

    // [] → global.
    const toGlobal = await request(app).patch(`/api/admin/people/${orgAdmin.user._id}/organizations`).set(t).send({ organizationIds: [] });
    assert.equal(toGlobal.body.admin.adminOrganizationIds, null);
    assert.equal((await request(app).get("/api/admin/people").set(auth(orgAdmin.token))).status, 200);

    const rows = await AdminAudit.find({ action: "admin-scope" }).sort({ _id: 1 });
    assert.deepEqual(
      rows.map((r) => [r.meta.from, r.meta.to]),
      [
        ["City Annex", "City Annex, Main campus"],
        ["City Annex, Main campus", "City Annex"],
        ["City Annex", "All organizations"],
      ]
    );
    assert.equal(rows[0].actor.email, "global@example.com");
    assert.equal(rows[0].meta.email, "annex-admin@example.com");
    const invite = await AdminAudit.findOne({ action: "admin-invite" });
    assert.equal(invite.meta.to, "City Annex");
    // Visible in the "staff" category for global admins.
    const log = await request(app).get("/api/admin/audit?category=staff").set(t);
    assert.ok(log.body.events.some((e) => e.action === "admin-scope"));
  });

  it("assignment guard rails: self, unknown org, non-admins, bad input", async () => {
    const t = auth(global.token);
    const self = await request(app).patch(`/api/admin/people/${global.user._id}/organizations`).set(t).send({ organizationIds: [annex.org.id] });
    assert.equal(self.status, 400);
    const unknown = await request(app)
      .patch(`/api/admin/people/${orgAdmin.user._id}/organizations`)
      .set(t)
      .send({ organizationIds: [String(new mongoose.Types.ObjectId())] });
    assert.equal(unknown.status, 404);
    const notAdmin = await request(app).patch(`/api/admin/people/${mainStaff.user._id}/organizations`).set(t).send({ organizationIds: ["default"] });
    assert.equal(notAdmin.status, 404);
    const badList = await request(app).patch(`/api/admin/people/${orgAdmin.user._id}/organizations`).set(t).send({ organizationIds: "default" });
    assert.equal(badList.status, 400);
    const noOrgInvite = await request(app)
      .post("/api/admin/admins")
      .set(t)
      .send({ name: "No Org", email: "no-org@example.com", temporaryPassword: PASSWORD, organizationIds: [] });
    assert.equal(noOrgInvite.status, 400);
    assert.deepEqual((await User.findById(orgAdmin.user._id)).adminOrganizations, [annex.org.id]);
    assert.equal(await AdminAudit.countDocuments({ action: "admin-scope" }), 0);
  });

  it("keeps at least one global admin", async () => {
    const other = await makeUser(app, "other@example.com", { role: "admin" });
    // Two global admins: one may scope the other.
    const scoped = await request(app).patch(`/api/admin/people/${global.user._id}/organizations`).set(auth(other.token)).send({ organizationIds: ["default"] });
    assert.equal(scoped.status, 200);
    // `other` is now the only global admin; scoping them is refused.
    const { setAdminOrganizations } = await import("../src/services/adminScope.js");
    await assert.rejects(
      setAdminOrganizations({ actor: { _id: new mongoose.Types.ObjectId() }, userId: String(other.user._id), organizationIds: ["default"] }),
      (err) => err.status === 409 && /at least one global admin/.test(err.message)
    );
    assert.deepEqual((await User.findById(other.user._id)).adminOrganizations, []);
  });

  it("staff can be moved to another organization by a global admin, and the move is audited", async () => {
    const moved = await request(app).patch(`/api/admin/staff/${mainStaff.user._id}`).set(auth(global.token)).send({ venueId: annex.venue.id });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.staff.staffVenueId, annex.venue.id);
    assert.deepEqual(moved.body.staff.staffQueueIds, []);
    const row = await AdminAudit.findOne({ action: "staff-move" });
    assert.equal(row.meta.email, "riya@example.com");
    assert.equal(row.meta.fromOrg, "Main campus");
    assert.equal(row.meta.toOrg, "City Annex");
    assert.equal(await AdminAudit.countDocuments({ action: "staff-access" }), 0, "a pure move is one entry");
    // Same token: now the annex, not the cafeteria.
    assert.equal((await request(app).get(`/api/admin/queues/${cafe._id}/waiting-list`).set(auth(mainStaff.token))).status, 403);
    assert.equal((await request(app).get(`/api/admin/queues/${annex.queue.id}/waiting-list`).set(auth(mainStaff.token))).status, 200);
    // The org admin now manages them.
    const list = await request(app).get("/api/admin/staff").set(auth(orgAdmin.token));
    assert.deepEqual(list.body.staff.map((s) => s.email), ["riya@example.com"]);
    const people = await request(app).get("/api/admin/people").set(auth(global.token));
    const riya = people.body.people.find((p) => p.email === "riya@example.com");
    assert.deepEqual(riya.organizations.map((o) => o.name), ["City Annex"]);
    assert.equal(riya.venue.name, "Outpatient Block");
  });

  it("fails closed: unknown organizations or an unloaded scope grant nothing", async () => {
    const ghost = await makeUser(app, "ghost@example.com", { role: "admin", adminOrganizations: [String(new mongoose.Types.ObjectId())] });
    const catalog = await request(app).get("/api/admin/catalog").set(auth(ghost.token));
    assert.deepEqual(catalog.body.venues, []);
    assert.equal((await request(app).get(`/api/admin/queues/${cafe._id}/waiting-list`).set(auth(ghost.token))).status, 403);
    const analytics = await request(app).get("/api/admin/analytics").set(auth(ghost.token));
    assert.ok(!JSON.stringify(analytics.body).includes("Cafeteria"));

    const fresh = await User.findById(orgAdmin.user._id);
    assert.equal(isOrgAdmin(fresh), true);
    assert.equal(isGlobalAdmin(fresh), false);
    assert.equal(canAccessVenue(fresh, annex.venue.id), false, "scope not loaded → no access");
    assert.deepEqual(scopedVenueIds(fresh), []);
    await loadAccessScope(fresh);
    assert.equal(canAccessVenue(fresh, annex.venue.id), true);
    assert.equal(canAccessVenue(fresh, mainVenueId), false);
  });

  it("a student can't become scoped by accident", async () => {
    const student = await User.create({ email: "s@example.com", name: "S", passwordHash: "x", role: "user", adminOrganizations: ["default"] });
    assert.deepEqual(student.adminOrganizations, []);
    assert.equal(student.toPublicJSON().adminOrganizationIds, null);
  });

  describe("socket rooms", () => {
    let httpServer;
    let io;
    let url;
    beforeEach(async () => {
      httpServer = createServer(app);
      io = createRealtimeServer(httpServer, { clientOrigin: true });
      await new Promise((resolve) => httpServer.listen(0, resolve));
      url = `http://127.0.0.1:${httpServer.address().port}`;
    });
    async function subscribeAs(token, queueId) {
      const socket = createSocketClient(url, { transports: ["websocket"], reconnection: false, timeout: 2000, auth: { token } });
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      const ack = await new Promise((resolve) => socket.emit("subscribe", { queueId }, resolve));
      socket.disconnect();
      return ack;
    }
    it("organization admins only join rooms for their organizations' queues", async () => {
      try {
        const other = await subscribeAs(orgAdmin.token, String(cafe._id));
        assert.deepEqual(other, { ok: false, error: "You don't have access to this venue" });
        const own = await subscribeAs(orgAdmin.token, annex.queue.id);
        assert.deepEqual(own, { ok: true });
        const globalAck = await subscribeAs(global.token, String(cafe._id));
        assert.deepEqual(globalAck, { ok: true });
        // Widened scope applies on the next subscribe, no new token needed.
        await User.updateOne({ _id: orgAdmin.user._id }, { $set: { adminOrganizations: [annex.org.id, "default"] } });
        assert.deepEqual(await subscribeAs(orgAdmin.token, String(cafe._id)), { ok: true });
      } finally {
        io.close();
        await new Promise((resolve) => httpServer.close(resolve));
      }
    });
  });
});
