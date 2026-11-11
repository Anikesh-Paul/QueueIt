import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AUTH_MOTIF_LINE, AUTH_SUBTITLE, FORGOT_PASSWORD_NOTICE } from "./auth-copy.js";

describe("auth campus copy", () => {
  it("uses concrete mess-line copy, not a hallway marketing line", () => {
    assert.equal(AUTH_MOTIF_LINE, "Hold your place in the mess line on your phone.");
    assert.equal(AUTH_MOTIF_LINE.includes("hallway"), false);
  });

  it("shares one campus subtitle on login and register", () => {
    assert.equal(AUTH_SUBTITLE, "One account for every line on this campus.");
  });
});

describe("forgot-password notice", () => {
  it("stays neutral and does not mention server logs or development", () => {
    assert.equal(
      FORGOT_PASSWORD_NOTICE,
      "If an account exists for that email, we sent a reset link."
    );
    const lower = FORGOT_PASSWORD_NOTICE.toLowerCase();
    assert.equal(lower.includes("server log"), false);
    assert.equal(lower.includes("development"), false);
    assert.equal(lower.includes("smtp"), false);
  });
});
