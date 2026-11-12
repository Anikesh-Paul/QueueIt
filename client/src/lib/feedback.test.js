import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canRateVisit, nextPrompt, ratingWordKey } from "./feedback.js";

describe("feedback helpers", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  it("only served, unrated, recent visits can be rated", () => {
    assert.equal(canRateVisit({ status: "served", updatedAt: "2026-11-12T10:00:00Z" }, now), true);
    assert.equal(canRateVisit({ status: "served", updatedAt: "2026-11-01T10:00:00Z" }, now), false);
    assert.equal(canRateVisit({ status: "served", updatedAt: "2026-11-12T10:00:00Z", feedback: { rating: 4 } }, now), false);
    assert.equal(canRateVisit({ status: "left", updatedAt: "2026-11-12T10:00:00Z" }, now), false);
  });
  it("skips dismissed prompts", () => {
    const pending = [{ entryId: "a" }, { entryId: "b" }];
    assert.equal(nextPrompt(pending, ["a"]).entryId, "b");
    assert.equal(nextPrompt(pending, ["a", "b"]), null);
    assert.equal(nextPrompt([], []), null);
  });
  it("maps ratings to word keys", () => {
    assert.equal(ratingWordKey(5), "feedback.rating5");
    assert.equal(ratingWordKey(0), null);
  });
});
