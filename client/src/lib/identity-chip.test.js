import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  identityChipLabel,
  shouldShowRoleBadge,
} from "./identity-chip.js";

describe("identityChipLabel", () => {
  it("prefers the trimmed display name", () => {
    assert.equal(identityChipLabel({ name: "  Demo User  ", role: "user" }), "Demo User");
  });

  it("falls back to Guest or Account when the name is missing", () => {
    assert.equal(identityChipLabel({ role: "guest" }), "Guest");
    assert.equal(identityChipLabel({ role: "user" }), "Account");
  });
});

describe("shouldShowRoleBadge", () => {
  it("keeps Admin and Staff badges", () => {
    assert.equal(shouldShowRoleBadge("admin", "Demo Admin"), true);
    assert.equal(shouldShowRoleBadge("staff", "Cafeteria Staff"), true);
  });

  it("hides the Guest badge when the label is already Guest", () => {
    assert.equal(shouldShowRoleBadge("guest", "Guest"), false);
  });

  it("omits the User badge so the name is not confused with the role", () => {
    assert.equal(shouldShowRoleBadge("user", "Demo User"), false);
  });
});
