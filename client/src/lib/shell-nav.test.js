import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shellNavEnd } from "./shell-nav.js";

describe("shellNavEnd", () => {
  it("is exact for the admin console path so Analytics is not also current", () => {
    assert.equal(shellNavEnd("/admin/queues/abc123"), true);
  });

  it("is not exact for Analytics, catalog, or student routes", () => {
    assert.equal(shellNavEnd("/admin/queues/abc123/analytics"), false);
    assert.equal(shellNavEnd("/admin/catalog"), false);
    assert.equal(shellNavEnd("/queues"), false);
    assert.equal(shellNavEnd("/status"), false);
  });
});
