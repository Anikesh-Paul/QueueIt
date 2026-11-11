import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { User } from "../src/models/User.js";
import { PasswordReset } from "../src/models/PasswordReset.js";
import { setMailer, resetMailer } from "../src/services/mailer.js";
import {
  RESET_NOTICE,
  RESET_INVALID,
  hashResetToken,
  issueResetToken,
} from "../src/services/passwordReset.js";

describe("Password reset (HTTP API)", () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    resetMailer();
    await teardownTestDb();
  });

  beforeEach(async () => {
    resetMailer();
    await resetDb();
  });

  async function registerStudent(app, email = "reset@example.com") {
    const res = await request(app).post("/api/auth/register").send({
      email,
      password: "password123",
      name: "Reset Student",
    });
    assert.equal(res.status, 201);
    return res.body;
  }

  it("returns a generic message for unknown and known emails, and mails a link only when registered", async () => {
    const app = testApp();
    await registerStudent(app);
    const sent = [];
    setMailer((payload) => {
      sent.push(payload);
    });

    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "missing@example.com" });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.message, RESET_NOTICE);
    assert.equal(sent.length, 0);

    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "reset@example.com" });
    assert.equal(known.status, 200);
    assert.equal(known.body.message, RESET_NOTICE);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "reset@example.com");
    assert.match(sent[0].resetUrl, /\/reset-password\?token=/);
    assert.equal("token" in known.body, false);
    assert.equal("resetUrl" in known.body, false);
    assert.equal("resetToken" in known.body, false);
    assert.deepEqual(Object.keys(known.body), ["message"]);
    assert.equal(JSON.stringify(unknown.body).includes("reset-password"), false);
    assert.equal(JSON.stringify(known.body).includes("reset-password"), false);
    assert.equal(JSON.stringify(known.body).includes(sent[0].resetUrl), false);
  });

  it("resets the password with a valid token, signs the user in, and rejects reuse", async () => {
    const app = testApp();
    await registerStudent(app);
    let resetUrl = "";
    setMailer((payload) => {
      resetUrl = payload.resetUrl;
    });
    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "reset@example.com" });
    assert.equal(forgot.status, 200);
    const raw = new URL(resetUrl).searchParams.get("token");
    assert.ok(raw);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: raw, password: "new-password-99" });
    assert.equal(reset.status, 200);
    assert.equal(typeof reset.body.token, "string");
    assert.equal(reset.body.user.email, "reset@example.com");

    const oldLogin = await request(app).post("/api/auth/login").send({
      email: "reset@example.com",
      password: "password123",
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await request(app).post("/api/auth/login").send({
      email: "reset@example.com",
      password: "new-password-99",
    });
    assert.equal(newLogin.status, 200);

    const reused = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: raw, password: "another-password-1" });
    assert.equal(reused.status, 400);
    assert.equal(reused.body.error, RESET_INVALID);
  });

  it("rejects an expired reset token", async () => {
    const app = testApp();
    const registered = await registerStudent(app);
    const user = await User.findOne({ email: "reset@example.com" });
    const raw = issueResetToken();
    await PasswordReset.create({
      user: user._id,
      tokenHash: hashResetToken(raw),
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: raw, password: "new-password-99" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, RESET_INVALID);

    const login = await request(app).post("/api/auth/login").send({
      email: registered.user.email,
      password: "password123",
    });
    assert.equal(login.status, 200);
  });

  it("rejects a short password on reset", async () => {
    const app = testApp();
    await registerStudent(app);
    let resetUrl = "";
    setMailer((payload) => {
      resetUrl = payload.resetUrl;
    });
    await request(app).post("/api/auth/forgot-password").send({ email: "reset@example.com" });
    const raw = new URL(resetUrl).searchParams.get("token");
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: raw, password: "short" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least 8/i);
  });
});
