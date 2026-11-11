import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAIN_CONTENT_ID,
  SKIP_TO_CONTENT_HREF,
  SKIP_TO_CONTENT_LABEL,
} from "./skip-to-content.js";

describe("skip-to-content", () => {
  it("targets the main landmark without changing the path", () => {
    assert.equal(MAIN_CONTENT_ID, "main-content");
    assert.equal(SKIP_TO_CONTENT_HREF, "#main-content");
    assert.match(SKIP_TO_CONTENT_LABEL, /skip to content/i);
    assert.doesNotMatch(SKIP_TO_CONTENT_HREF, /^\//);
  });
});
