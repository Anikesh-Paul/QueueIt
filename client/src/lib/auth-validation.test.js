import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capsLockOn,
  confirmError,
  describeAuthError,
  emailError,
  nameError,
  passwordError,
  validateAuthForm,
} from "./auth-validation.js";
import { MESSAGES } from "./i18n.js";

describe("auth field checks", () => {
  it("checks email presence and shape", () => {
    assert.equal(emailError(""), "auth.emailRequired");
    assert.equal(emailError("   "), "auth.emailRequired");
    assert.equal(emailError("ana"), "auth.emailInvalid");
    assert.equal(emailError("ana@campus"), "auth.emailInvalid");
    assert.equal(emailError("a b@x.com"), "auth.emailInvalid");
    assert.equal(emailError(" ana@campus.edu "), "");
  });

  it("only requires a password to log in, but enforces 8–128 to register or reset", () => {
    assert.equal(passwordError(""), "auth.passwordRequired");
    assert.equal(passwordError("short"), "");
    assert.equal(passwordError("x".repeat(129)), "auth.passwordLong");
    assert.equal(passwordError("short", { mode: "register" }), "auth.passwordShort");
    assert.equal(passwordError("long-enough", { mode: "register" }), "");
    assert.equal(passwordError("x".repeat(129), { mode: "reset" }), "auth.passwordLong");
  });

  it("checks name and confirmation", () => {
    assert.equal(nameError("  "), "auth.nameRequired");
    assert.equal(nameError("Riya"), "");
    assert.equal(confirmError("abcdefgh", ""), "auth.passwordRequired");
    assert.equal(confirmError("abcdefgh", "abcdefgx"), "reset.mismatch");
    assert.equal(confirmError("abcdefgh", "abcdefgh"), "");
  });

  it("validates a whole form", () => {
    assert.deepEqual(validateAuthForm({ mode: "login", email: "a@b.co", password: "x" }), {});
    assert.deepEqual(validateAuthForm({ mode: "register", name: "", email: "bad", password: "123" }), {
      name: "auth.nameRequired",
      email: "auth.emailInvalid",
      password: "auth.passwordShort",
    });
  });
});

describe("auth error messages", () => {
  it("treats 429 as a paused sign-in and network failure as offline", () => {
    assert.deepEqual(describeAuthError({ status: 429, message: "Too many attempts, try again later" }), {
      kind: "locked",
      key: "auth.lockedBody",
      message: "",
    });
    assert.equal(describeAuthError({ offline: true, message: "x" }).kind, "offline");
  });

  it("translates the server's known messages and passes unknown ones through", () => {
    assert.equal(describeAuthError({ status: 401, message: "Invalid email or password" }).key, "auth.invalidLogin");
    assert.equal(describeAuthError({ status: 409, message: "Email already registered" }).key, "auth.emailTaken");
    assert.deepEqual(describeAuthError({ status: 500, message: "Boom" }), { kind: "error", key: "", message: "Boom" });
    assert.equal(describeAuthError({ status: 500 }).key, "auth.requestFailed");
    assert.equal(describeAuthError(null), null);
  });

  it("every key it can return exists in English", () => {
    const keys = [
      "auth.emailRequired", "auth.emailInvalid", "auth.passwordRequired", "auth.passwordShort", "auth.passwordLong",
      "auth.nameRequired", "reset.mismatch", "auth.invalidLogin", "auth.emailTaken", "auth.missingFields",
      "auth.challengeExpired", "auth.lockedBody", "offline.generic", "auth.requestFailed",
    ];
    for (const k of keys) assert.ok(k in MESSAGES.en, k);
  });

  it("reads Caps Lock from the keyboard event", () => {
    assert.equal(capsLockOn({ getModifierState: (k) => k === "CapsLock" }), true);
    assert.equal(capsLockOn({ getModifierState: () => false }), false);
    assert.equal(capsLockOn({}), false);
  });
});
