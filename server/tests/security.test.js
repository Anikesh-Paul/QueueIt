import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import { setupTestDb, teardownTestDb, resetDb, testApp } from "./helpers.js";
import { User } from "../src/models/User.js";
import { AdminAudit } from "../src/models/AdminAudit.js";
import { LoginThrottle } from "../src/models/LoginThrottle.js";
import { PasswordReset } from "../src/models/PasswordReset.js";
import { setMailer, resetMailer } from "../src/services/mailer.js";
import { setNow, resetClock, advanceMs, now as clockNow } from "../src/services/clock.js";
import { base32Decode, base32Encode, hotp, totpCode, verifyTotp, otpauthUrl } from "../src/services/totp.js";
import { openSecret, sealSecret, secretBoxKey } from "../src/services/secretBox.js";
import { ACCOUNT_MAX_FAILURES, IP_MAX_FAILURES, LOGIN_LOCK_MS } from "../src/services/loginThrottle.js";
import { auditCategoryOf } from "../src/services/adminAudit.js";

const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vectors (SHA-1, last 6 digits)", () => {
    assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert.equal(totpCode(RFC_SECRET, 59 * 1000), "287082");
    assert.equal(totpCode(RFC_SECRET, 1111111109 * 1000), "081804");
    assert.equal(totpCode(RFC_SECRET, 2000000000 * 1000), "279037");
    assert.equal(hotp(RFC_SECRET, 0), "755224");
  });

  it("round-trips base32", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
    assert.throws(() => base32Decode("not*base32"));
  });

  it("accepts one step of drift, refuses replays and junk", () => {
    const at = 1_700_000_000_000;
    const now = totpCode(RFC_SECRET, at);
    const prev = totpCode(RFC_SECRET, at - 30_000);
    const old = totpCode(RFC_SECRET, at - 90_000);
    const step = verifyTotp(RFC_SECRET, now, { atMs: at });
    assert.ok(step);
    assert.ok(verifyTotp(RFC_SECRET, prev, { atMs: at }));
    assert.equal(verifyTotp(RFC_SECRET, old, { atMs: at }), null);
    assert.equal(verifyTotp(RFC_SECRET, now, { atMs: at, afterStep: step }), null, "same code twice");
    assert.equal(verifyTotp(RFC_SECRET, "12345", { atMs: at }), null);
    assert.equal(verifyTotp(RFC_SECRET, "abcdef", { atMs: at }), null);
    assert.ok(verifyTotp(RFC_SECRET, `${now.slice(0, 3)} ${now.slice(3)}`, { atMs: at }), "spaces allowed");
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const url = otpauthUrl({ secret: RFC_SECRET, account: "a@b.c" });
    assert.match(url, /^otpauth:\/\/totp\/QueueIt%3Aa%40b\.c\?/);
    assert.match(url, /secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
    assert.match(url, /issuer=QueueIt/);
  });
});

describe("secret box (TOTP seeds at rest)", () => {
  it("encrypts with a key derived from JWT_SECRET by default", () => {
    const key = secretBoxKey({ JWT_SECRET: "s1" });
    const sealed = sealSecret("SEED", key);
    assert.doesNotMatch(sealed, /SEED/);
    assert.equal(openSecret(sealed, key), "SEED");
    assert.equal(openSecret(sealed, secretBoxKey({ JWT_SECRET: "s2" })), null, "other JWT secret");
  });

  it("prefers a dedicated TOTP_ENCRYPTION_KEY", () => {
    const dedicated = secretBoxKey({ JWT_SECRET: "s1", TOTP_ENCRYPTION_KEY: "k" });
    assert.notDeepEqual(dedicated, secretBoxKey({ JWT_SECRET: "s1" }));
    assert.equal(openSecret(sealSecret("x", dedicated), dedicated), "x");
  });

  it("detects tampering", () => {
    const key = secretBoxKey({ JWT_SECRET: "s1" });
    const parts = sealSecret("SEED", key).split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    assert.equal(openSecret(parts.join("."), key), null);
    assert.equal(openSecret("garbage", key), null);
    assert.equal(openSecret(null, key), null);
  });
});

describe("Security pass (HTTP API)", () => {
  let app;

  before(async () => {
    await setupTestDb();
    await LoginThrottle.syncIndexes();
  });
  after(async () => {
    resetClock();
    resetMailer();
    await teardownTestDb();
  });
  beforeEach(async () => {
    setNow("2026-11-13T10:00:00Z");
    await resetDb();
    app = testApp();
  });

  /** Authenticator code on the API's (frozen) clock. */
  const codeFor = (secret) => totpCode(secret, clockNow().getTime());

  async function makeUser({ email = "admin@example.com", role = "admin", password = "password123" } = {}) {
    return User.create({ email, name: "Asha Admin", role, passwordHash: await User.hashPassword(password) });
  }

  async function login(email = "admin@example.com", password = "password123", a = app) {
    return request(a).post("/api/auth/login").send({ email, password });
  }

  /** Enroll and return { secret, backupCodes, token }. */
  async function enroll(token) {
    const setup = await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${token}`).send({ password: "password123" });
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    const enable = await request(app)
      .post("/api/auth/2fa/enable")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: codeFor(setup.body.secret) });
    assert.equal(enable.status, 200, JSON.stringify(enable.body));
    return { secret: setup.body.secret, otpauthUrl: setup.body.otpauthUrl, backupCodes: enable.body.backupCodes };
  }

  describe("sign out of all devices (token versioning)", () => {
    it("keeps tokens from before versioning working on old documents", async () => {
      const user = await makeUser();
      await User.collection.updateOne({ _id: user._id }, { $unset: { tokenVersion: "", twoFactorEnabled: "" } });
      const legacy = jwt.sign({ sub: user._id.toString(), role: "admin", email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
      const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${legacy}`);
      assert.equal(me.status, 200);
      assert.equal(me.body.user.twoFactorEnabled, false);
      const two = await request(app).get("/api/auth/2fa").set("Authorization", `Bearer ${legacy}`);
      assert.equal(two.body.twoFactor.enabled, false);
      assert.equal(two.body.twoFactor.eligible, true);
    });

    it("rejects every earlier token after sign-out-all and records it", async () => {
      await makeUser({ email: "s@example.com", role: "user" });
      const a = (await login("s@example.com")).body.token;
      const b = (await login("s@example.com")).body.token;
      const out = await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${a}`);
      assert.equal(out.status, 200);
      for (const t of [a, b]) {
        const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${t}`);
        assert.equal(me.status, 401);
        assert.equal(me.body.error, "Invalid or expired token");
      }
      const fresh = (await login("s@example.com")).body.token;
      assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${fresh}`)).status, 200);
      const row = await AdminAudit.findOne({ action: "sign-out-all" });
      assert.equal(row.actor.email, "s@example.com");
      assert.equal(auditCategoryOf("sign-out-all"), "security");
    });

    it("needs a session", async () => {
      assert.equal((await request(app).post("/api/auth/logout-all")).status, 401);
    });
  });

  describe("two-step sign-in", () => {
    it("is only for admin and staff, and needs the current password to start", async () => {
      await makeUser({ email: "stu@example.com", role: "user" });
      const stu = (await login("stu@example.com")).body.token;
      const r = await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${stu}`).send({ password: "password123" });
      assert.equal(r.status, 403);

      await makeUser();
      const adm = (await login()).body.token;
      const bad = await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${adm}`).send({ password: "nope-nope" });
      assert.equal(bad.status, 401);
    });

    it("enrolls with a QR seed, stores it encrypted, and refuses a wrong first code", async () => {
      const user = await makeUser();
      const token = (await login()).body.token;
      const setup = await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${token}`).send({ password: "password123" });
      assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\//);
      const wrong = await request(app).post("/api/auth/2fa/enable").set("Authorization", `Bearer ${token}`).send({ code: "000000" === codeFor(setup.body.secret) ? "111111" : "000000" });
      assert.equal(wrong.status, 400);
      const ok = await request(app).post("/api/auth/2fa/enable").set("Authorization", `Bearer ${token}`).send({ code: codeFor(setup.body.secret) });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.backupCodes.length, 10);
      assert.equal(ok.body.user.twoFactorEnabled, true);

      const stored = await User.findById(user._id).select("+twoFactorSecret +twoFactorBackupCodes").lean();
      assert.ok(stored.twoFactorSecret.startsWith("v1."));
      assert.ok(!stored.twoFactorSecret.includes(setup.body.secret), "seed not stored in clear");
      assert.ok(!stored.twoFactorBackupCodes.includes(ok.body.backupCodes[0]), "backup codes hashed");
      assert.ok(await AdminAudit.findOne({ action: "2fa-enabled", "actor.email": "admin@example.com" }));
      // Existing session stays valid after enrolling.
      assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status, 200);
    });

    it("asks for a code after the password; the challenge is not a session", async () => {
      await makeUser();
      const { secret } = await enroll((await login()).body.token);
      const first = await login();
      assert.equal(first.status, 200);
      assert.equal(first.body.twoFactorRequired, true);
      assert.equal(first.body.token, undefined);
      const asBearer = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${first.body.challenge}`);
      assert.equal(asBearer.status, 401);

      const wrong = await request(app).post("/api/auth/login/2fa").send({ challenge: first.body.challenge, code: "12345" });
      assert.equal(wrong.status, 401);

      advanceToNextStep();
      const code = codeFor(secret);
      const ok = await request(app).post("/api/auth/login/2fa").send({ challenge: first.body.challenge, code });
      assert.equal(ok.status, 200);
      assert.ok(ok.body.token);
      assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${ok.body.token}`)).status, 200);

      const replay = await request(app).post("/api/auth/login/2fa").send({ challenge: first.body.challenge, code });
      assert.equal(replay.status, 401, "a code works once");
    });

    it("backup codes work once each", async () => {
      await makeUser();
      const { backupCodes } = await enroll((await login()).body.token);
      const c1 = (await login()).body.challenge;
      const ok = await request(app).post("/api/auth/login/2fa").send({ challenge: c1, code: backupCodes[0].toUpperCase() });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.backupCodesRemaining, 9);
      const c2 = (await login()).body.challenge;
      const again = await request(app).post("/api/auth/login/2fa").send({ challenge: c2, code: backupCodes[0] });
      assert.equal(again.status, 401);
    });

    it("an expired or tampered challenge is refused", async () => {
      await makeUser();
      const { secret } = await enroll((await login()).body.token);
      const challenge = (await login()).body.challenge;
      const tampered = `${challenge.slice(0, -2)}xx`;
      assert.equal((await request(app).post("/api/auth/login/2fa").send({ challenge: tampered, code: codeFor(secret) })).status, 401);
      const expired = jwt.sign({ sub: "x", typ: "2fa", tv: 0 }, process.env.JWT_SECRET, { expiresIn: -10, audience: "queueit-2fa" });
      assert.equal((await request(app).post("/api/auth/login/2fa").send({ challenge: expired, code: "123456" })).status, 401);
    });

    it("disabling needs a current code and is audited", async () => {
      await makeUser();
      const token = (await login()).body.token;
      const { secret } = await enroll(token);
      const noCode = await request(app).post("/api/auth/2fa/disable").set("Authorization", `Bearer ${token}`).send({ code: "" });
      assert.equal(noCode.status, 400);
      advanceToNextStep();
      const off = await request(app).post("/api/auth/2fa/disable").set("Authorization", `Bearer ${token}`).send({ code: codeFor(secret) });
      assert.equal(off.status, 200);
      assert.equal(off.body.twoFactor.enabled, false);
      assert.ok((await login()).body.token, "password-only again");
      const row = await AdminAudit.findOne({ action: "2fa-disabled" });
      assert.equal(row.meta.with, "totp");
      const stored = await User.findOne({ email: "admin@example.com" }).select("+twoFactorSecret +twoFactorBackupCodes").lean();
      assert.equal(stored.twoFactorSecret, null);
      assert.deepEqual(stored.twoFactorBackupCodes, []);
    });

    it("can replace backup codes with a current code", async () => {
      await makeUser();
      const token = (await login()).body.token;
      const { backupCodes } = await enroll(token);
      const res = await request(app).post("/api/auth/2fa/backup-codes").set("Authorization", `Bearer ${token}`).send({ code: backupCodes[1] });
      assert.equal(res.status, 200);
      assert.equal(res.body.backupCodes.length, 10);
      const c = (await login()).body.challenge;
      assert.equal((await request(app).post("/api/auth/login/2fa").send({ challenge: c, code: backupCodes[2] })).status, 401, "old set retired");
    });
  });

  describe("password reset", () => {
    async function resetLinkFor(email) {
      let link = null;
      setMailer(async ({ resetUrl }) => {
        link = new URL(resetUrl).searchParams.get("token");
      });
      await request(app).post("/api/auth/forgot-password").send({ email });
      return link;
    }

    it("is single-use, signs out old sessions, and still asks 2FA accounts for a code", async () => {
      await makeUser();
      const old = (await login()).body.token;
      await enroll(old);
      const raw = await resetLinkFor("admin@example.com");
      assert.ok(raw, "mailer received a token");
      const reset = await request(app).post("/api/auth/reset-password").send({ token: raw, password: "brand-new-pass1" });
      assert.equal(reset.status, 200);
      assert.equal(reset.body.twoFactorRequired, true);
      assert.equal(reset.body.token, undefined);
      assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${old}`)).status, 401);
      const reuse = await request(app).post("/api/auth/reset-password").send({ token: raw, password: "another-pass12" });
      assert.equal(reuse.status, 400);
      assert.equal(await PasswordReset.countDocuments({ usedAt: null }), 0);
    });

    it("expired links are refused", async () => {
      await makeUser({ email: "s@example.com", role: "user" });
      const raw = await resetLinkFor("s@example.com");
      await PasswordReset.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await request(app).post("/api/auth/reset-password").send({ token: raw, password: "brand-new-pass1" });
      assert.equal(res.status, 400);
    });
  });

  describe("lockout", () => {
    it("locks an account after repeated failures with the same generic error, then recovers", async () => {
      const locked = testApp({ loginLockout: true });
      await makeUser({ email: "s@example.com", role: "user" });
      const statuses = [];
      for (let i = 0; i < ACCOUNT_MAX_FAILURES; i += 1) {
        const r = await login("s@example.com", "wrong-password", locked);
        statuses.push(r.status);
        if (r.status === 401) assert.equal(r.body.error, "Invalid email or password");
      }
      assert.deepEqual(statuses.slice(0, -1), Array(ACCOUNT_MAX_FAILURES - 1).fill(401));
      assert.equal(statuses.at(-1), 429);
      const right = await login("s@example.com", "password123", locked);
      assert.equal(right.status, 429, "even the right password waits");
      assert.equal(right.body.error, "Too many attempts, try again later");
      assert.ok(Number(right.headers["retry-after"]) > 0);

      const row = await AdminAudit.findOne({ action: "login-lockout" });
      assert.equal(row.meta.scope, "account");
      assert.equal(row.meta.email, "s@example.com");
      assert.equal(auditCategoryOf("login-lockout"), "security");

      advanceMs(LOGIN_LOCK_MS + 1000);
      const after = await login("s@example.com", "password123", locked);
      assert.equal(after.status, 200);
      assert.ok(after.body.token);
    });

    it("unknown emails behave exactly like real ones (no enumeration)", async () => {
      const locked = testApp({ loginLockout: true });
      const statuses = [];
      for (let i = 0; i < ACCOUNT_MAX_FAILURES + 1; i += 1) {
        const r = await login("ghost@example.com", "wrong-password", locked);
        statuses.push(`${r.status}:${r.body.error}`);
      }
      assert.equal(statuses[0], "401:Invalid email or password");
      assert.equal(statuses.at(-1), "429:Too many attempts, try again later");
      const stored = await LoginThrottle.find().lean();
      assert.ok(stored.every((d) => !d.key.includes("ghost")), "keys are hashed");
    });

    it("locks an IP that sprays many accounts", async () => {
      const locked = testApp({ loginLockout: true });
      let last;
      for (let i = 0; i < IP_MAX_FAILURES; i += 1) {
        last = await login(`spray${i}@example.com`, "wrong-password", locked);
      }
      assert.equal(last.status, 429);
      await makeUser({ email: "real@example.com", role: "user" });
      assert.equal((await login("real@example.com", "password123", locked)).status, 429);
      assert.ok(await AdminAudit.findOne({ action: "login-lockout", "meta.scope": "ip" }));
    });

    it("wrong two-step codes count toward the lockout", async () => {
      const locked = testApp({ loginLockout: true });
      await makeUser();
      const token = (await login("admin@example.com", "password123", locked)).body.token;
      const setup = await request(locked).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${token}`).send({ password: "password123" });
      await request(locked).post("/api/auth/2fa/enable").set("Authorization", `Bearer ${token}`).send({ code: codeFor(setup.body.secret) });
      const challenge = (await login("admin@example.com", "password123", locked)).body.challenge;
      let last;
      for (let i = 0; i < ACCOUNT_MAX_FAILURES; i += 1) {
        last = await request(locked).post("/api/auth/login/2fa").send({ challenge, code: "nope-nope" });
      }
      assert.equal(last.status, 429);
      const row = await AdminAudit.findOne({ action: "login-lockout" });
      assert.equal(row.meta.stage, "two-step");
    });

    it("the per-IP failure limiter only counts failures", async () => {
      const limited = testApp({ rateLimit: true, loginFailureRateLimit: { windowMs: 60_000, max: 2 } });
      await makeUser({ email: "s@example.com", role: "user" });
      for (let i = 0; i < 4; i += 1) assert.equal((await login("s@example.com", "password123", limited)).status, 200);
      assert.equal((await login("s@example.com", "bad-password", limited)).status, 401);
      assert.equal((await login("s@example.com", "bad-password", limited)).status, 401);
      assert.equal((await login("s@example.com", "bad-password", limited)).status, 429);
    });
  });

  describe("headers", () => {
    it("API responses carry a locked-down CSP and helmet defaults", async () => {
      const res = await request(app).get("/api/health");
      assert.match(res.headers["content-security-policy"], /default-src 'none'/);
      assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["referrer-policy"], "no-referrer");
      assert.ok(res.headers["strict-transport-security"]);
      assert.equal(res.headers["x-powered-by"], undefined);
    });
  });

  function advanceToNextStep() {
    // Next 30 s step, so a fresh code differs from the one used at enrollment.
    advanceMs(30_000);
  }
});
