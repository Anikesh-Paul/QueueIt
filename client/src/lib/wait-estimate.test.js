import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  campusWeekday,
  catalogWaitLabel,
  confidenceLabel,
  estimateBasisLine,
  formatWaitRange,
  paceReadout,
} from "./wait-estimate.js";

const WED_IST = Date.parse("2026-11-11T05:00:00Z");

describe("wait estimate copy", () => {
  it("formats a range and collapses equal ends", () => {
    assert.equal(formatWaitRange({ low: 8, high: 12 }), "8–12 min");
    assert.equal(formatWaitRange({ low: 3, high: 3 }), "3 min");
    assert.equal(formatWaitRange(null), null);
    assert.equal(formatWaitRange({ low: 8, high: 12 }, "hi"), "8–12 मिनट");
  });

  it("phrases the catalog line", () => {
    assert.equal(catalogWaitLabel({ low: 4, high: 9 }), "Wait about 4–9 min");
    assert.equal(catalogWaitLabel({ low: 1, high: 1 }), "Little or no wait");
    assert.equal(catalogWaitLabel({ low: 0, high: 0, source: "empty" }), "Little or no wait");
    assert.equal(catalogWaitLabel(null), null);
  });

  it("explains the basis using the campus weekday", () => {
    assert.equal(campusWeekday(WED_IST), 3);
    // 23:00 UTC Tuesday is already Wednesday on campus.
    assert.equal(campusWeekday(Date.parse("2026-11-10T23:00:00Z")), 3);
    assert.equal(
      estimateBasisLine({ source: "blend", weeks: 4 }, { nowMs: WED_IST }),
      "Based on today's pace and the last 4 Wednesdays around this hour."
    );
    assert.match(estimateBasisLine({ source: "history", weeks: 4 }, { nowMs: WED_IST }), /today has only just started/);
    assert.match(estimateBasisLine({ source: "configured" }), /rough guide/i);
    assert.equal(estimateBasisLine(null), null);
  });

  it("labels confidence and the staff readout", () => {
    assert.equal(confidenceLabel("high"), "Usually accurate");
    assert.equal(confidenceLabel("nope"), null);
    assert.equal(paceReadout({ recentPace: 2, typicalPace: 5 }), "Today 2 min · Typical 5 min");
    assert.equal(paceReadout({ recentPace: null, typicalPace: null }), "Using the configured average");
  });
});
