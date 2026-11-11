import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AUTH_MOTIF_LINE, AUTH_SUBTITLE } from "./auth-copy.js";

describe("auth campus copy", () => {
  it("uses concrete mess-line copy, not a hallway marketing line", () => {
    assert.equal(AUTH_MOTIF_LINE, "Hold your place in the mess line on your phone.");
    assert.equal(AUTH_MOTIF_LINE.includes("hallway"), false);
  });

  it("shares one campus subtitle on login and register", () => {
    assert.equal(AUTH_SUBTITLE, "One account for every line on this campus.");
  });
});
