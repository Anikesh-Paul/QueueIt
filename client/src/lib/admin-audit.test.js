import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditActionLabel, auditMetaLine } from "./admin-audit.js";

describe("admin audit copy", () => {
  it("labels known actions and summarizes safe meta", () => {
    assert.equal(auditActionLabel("pause"), "Paused the queue");
    assert.equal(auditMetaLine({ meta: { tokenNumber: 12 } }), "token 12");
    assert.equal(auditMetaLine({ meta: { cleared: 3 } }), "3 places cleared");
  });
});
