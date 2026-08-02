import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { User } from "../src/models/User.js";
import { seedDemoAccounts } from "../src/seed.js";

function setSeedEnv() {
  process.env.SEED_ADMIN_EMAIL = "admin@queueit.local";
  process.env.SEED_ADMIN_PASSWORD = "admin-demo-pass";
  process.env.SEED_USER_EMAIL = "user@queueit.local";
  process.env.SEED_USER_PASSWORD = "user-demo-pass";
}

describe("Auth & roles (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetDb();
  });

  describe("POST /api/auth/register", () => {
    it("registers a student and returns a user-scoped JWT session", async () => {
      const app = testApp();
      const res = await request(app).post("/api/auth/register").send({
        email: "student@example.com",
        password: "password123",
        name: "Student One",
      });

      assert.equal(res.status, 201);
      assert.equal(typeof res.body.token, "string");
      assert.ok(res.body.token.length > 10);
      assert.equal(res.body.user.email, "student@example.com");
      assert.equal(res.body.user.name, "Student One");
      assert.equal(res.body.user.role, "user");
      assert.ok(res.body.user.id);
      assert.equal(res.body.user.password, undefined);
      assert.equal(res.body.user.passwordHash, undefined);
    });

    it("rejects duplicate email registration", async () => {
      const app = testApp();
      await request(app).post("/api/auth/register").send({
        email: "dup@example.com",
        password: "password123",
        name: "First",
      });

      const res = await request(app).post("/api/auth/register").send({
        email: "dup@example.com",
        password: "password123",
        name: "Second",
      });

      assert.equal(res.status, 409);
    });

    it("rejects register without email or password", async () => {
      const app = testApp();
      const res = await request(app).post("/api/auth/register").send({
        name: "No Creds",
      });

      assert.equal(res.status, 400);
    });
  });

  describe("POST /api/auth/login", () => {
    it("logs in a registered user and returns a user-scoped session", async () => {
      const app = testApp();
      await request(app).post("/api/auth/register").send({
        email: "login@example.com",
        password: "password123",
        name: "Login User",
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "login@example.com",
        password: "password123",
      });

      assert.equal(res.status, 200);
      assert.equal(typeof res.body.token, "string");
      assert.equal(res.body.user.email, "login@example.com");
      assert.equal(res.body.user.role, "user");
    });

    it("rejects invalid credentials", async () => {
      const app = testApp();
      await request(app).post("/api/auth/register").send({
        email: "wrong@example.com",
        password: "password123",
        name: "Wrong",
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "wrong@example.com",
        password: "not-the-password",
      });

      assert.equal(res.status, 401);
    });

    it("logs in seeded admin and returns an admin-scoped session", async () => {
      setSeedEnv();
      await seedDemoAccounts();

      const app = testApp();
      const res = await request(app).post("/api/auth/login").send({
        email: "admin@queueit.local",
        password: "admin-demo-pass",
      });

      assert.equal(res.status, 200);
      assert.equal(typeof res.body.token, "string");
      assert.equal(res.body.user.email, "admin@queueit.local");
      assert.equal(res.body.user.role, "admin");
    });

    it("logs in seeded demo user with user role", async () => {
      setSeedEnv();
      await seedDemoAccounts();

      const app = testApp();
      const res = await request(app).post("/api/auth/login").send({
        email: "user@queueit.local",
        password: "user-demo-pass",
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.user.role, "user");
    });
  });

  describe("Protected routes", () => {
    it("rejects unauthenticated access to GET /api/auth/me", async () => {
      const app = testApp();
      const res = await request(app).get("/api/auth/me");

      assert.equal(res.status, 401);
    });

    it("returns the current user when a valid token is provided", async () => {
      const app = testApp();
      const reg = await request(app).post("/api/auth/register").send({
        email: "me@example.com",
        password: "password123",
        name: "Me User",
      });

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${reg.body.token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "me@example.com");
      assert.equal(res.body.user.role, "user");
      assert.equal(res.body.user.passwordHash, undefined);
    });

    it("rejects a malformed Authorization header", async () => {
      const app = testApp();
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "NotBearer abc");

      assert.equal(res.status, 401);
    });
  });

  describe("Admin-only routes", () => {
    it("rejects unauthenticated access to GET /api/admin/ping", async () => {
      const app = testApp();
      const res = await request(app).get("/api/admin/ping");

      assert.equal(res.status, 401);
    });

    it("rejects a valid user token on admin-only API", async () => {
      const app = testApp();
      const reg = await request(app).post("/api/auth/register").send({
        email: "notadmin@example.com",
        password: "password123",
        name: "Regular User",
      });

      const res = await request(app)
        .get("/api/admin/ping")
        .set("Authorization", `Bearer ${reg.body.token}`);

      assert.equal(res.status, 403);
    });

    it("allows an admin token on admin-only API", async () => {
      setSeedEnv();
      await seedDemoAccounts();

      const app = testApp();
      const login = await request(app).post("/api/auth/login").send({
        email: "admin@queueit.local",
        password: "admin-demo-pass",
      });

      const res = await request(app)
        .get("/api/admin/ping")
        .set("Authorization", `Bearer ${login.body.token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.role, "admin");
    });
  });

  describe("seedDemoAccounts", () => {
    it("is idempotent and does not store plaintext passwords on the user document", async () => {
      setSeedEnv();
      await seedDemoAccounts();
      await seedDemoAccounts();

      const admins = await User.find({ email: "admin@queueit.local" }).select("+passwordHash");
      const users = await User.find({ email: "user@queueit.local" }).select("+passwordHash");

      assert.equal(admins.length, 1);
      assert.equal(users.length, 1);
      assert.equal(admins[0].role, "admin");
      assert.equal(users[0].role, "user");
      assert.notEqual(admins[0].passwordHash, "admin-demo-pass");
      assert.ok(admins[0].passwordHash.length > 20);
    });
  });
});
