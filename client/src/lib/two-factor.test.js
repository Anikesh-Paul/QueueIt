import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backupCodesFile,
  cleanCode,
  codeLooksComplete,
  groupSecret,
  isAuthenticatorCode,
  isBackupCode,
  loginOutcome,
} from "./two-factor.js";
import { auditActionLabel, auditMetaLine, AUDIT_CATEGORIES } from "./admin-audit.js";

describe("two-step helpers", () => {
  it("accepts six digits with spaces or a dash", () => {
    assert.equal(cleanCode(" 123 456 "), "123456");
    assert.equal(isAuthenticatorCode("123-456"), true);
    assert.equal(isAuthenticatorCode("12345"), false);
    assert.equal(isAuthenticatorCode("12345a"), false);
  });
  it("recognises backup codes", () => {
    assert.equal(isBackupCode("k3f9q-7xm2p"), true);
    assert.equal(isBackupCode("K3F9Q7XM2P"), true);
    assert.equal(isBackupCode("k3f9q"), false);
    assert.equal(codeLooksComplete("k3f9q-7xm2p", "backup"), true);
    assert.equal(codeLooksComplete("k3f9q-7xm2p", "app"), false);
  });
  it("groups the manual key", () => {
    assert.equal(groupSecret("jbswy3dpehpk3pxp"), "JBSW Y3DP EHPK 3PXP");
    assert.equal(groupSecret(""), "");
  });
  it("writes a readable backup code file", () => {
    const text = backupCodesFile(["aaaaa-bbbbb", "ccccc-ddddd"], { email: "a@b.c", issuedAt: new Date("2026-11-13T00:00:00Z") });
    assert.match(text, /Account: a@b.c/);
    assert.match(text, /Created: 2026-11-13/);
    assert.match(text, / 1\. aaaaa-bbbbb/);
    assert.match(text, / 2\. ccccc-ddddd/);
  });
  it("reads the login response", () => {
    assert.deepEqual(loginOutcome({ twoFactorRequired: true, challenge: "c" }), { step: "code", challenge: "c" });
    assert.deepEqual(loginOutcome({ token: "t" }), { step: "done" });
    assert.deepEqual(loginOutcome({}), { step: "error" });
  });
});

describe("security audit labels", () => {
  it("names the new actions and the filter group", () => {
    assert.equal(auditActionLabel("2fa-enabled"), "Turned on two-step sign-in");
    assert.equal(auditActionLabel("sign-out-all"), "Signed out of all devices");
    assert.ok(AUDIT_CATEGORIES.some((c) => c.id === "security"));
  });
  it("describes lockouts without leaking scope jargon", () => {
    const line = auditMetaLine({ meta: { scope: "account", email: "s@x.io", failures: 5, minutes: 15, stage: "password" } });
    assert.equal(line, "s@x.io · 5 failed attempts · locked 15 min");
    assert.equal(
      auditMetaLine({ meta: { scope: "ip", ip: "1.2.3.4", failures: 30, minutes: 15, stage: "two-step" } }),
      "IP 1.2.3.4 · 30 failed codes · locked 15 min"
    );
    assert.equal(auditMetaLine({ meta: { with: "backup" } }), "used a backup code");
  });
});

import { peekAuthFlash, setAuthFlash, takeAuthFlashNotice } from "./auth-flash.js";

describe("auth flash", () => {
  function mem() {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }
  it("carries a notice and a safe destination across redirects, once", () => {
    const s = mem();
    setAuthFlash({ notice: "hi", to: "/security" }, s);
    assert.deepEqual(peekAuthFlash(s), { notice: "hi", to: "/security" });
    assert.equal(takeAuthFlashNotice(s), "hi");
    assert.equal(takeAuthFlashNotice(s), "");
    assert.equal(peekAuthFlash(s), null);
  });
  it("ignores off-site destinations", () => {
    const s = mem();
    setAuthFlash({ notice: "", to: "//evil.example" }, s);
    assert.equal(peekAuthFlash(s).to, null);
    setAuthFlash({ to: "https://evil.example" }, s);
    assert.equal(peekAuthFlash(s).to, null);
  });
});
