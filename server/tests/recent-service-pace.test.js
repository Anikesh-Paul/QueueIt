import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { setNow, resetClock } from "../src/services/clock.js";
import {
  MIN_SERVE_INTERVALS,
  campusDayStart,
  computeRecentServicePace,
} from "../src/services/recentServicePace.js";

after(() => {
  resetClock();
});

describe("computeRecentServicePace", () => {
  it("falls back to the configured average when the sample is thin", () => {
    const none = computeRecentServicePace([], 3);
    assert.equal(none.source, "configured");
    assert.equal(none.pace, 3);
    assert.equal(none.intervalCount, 0);

    const start = new Date("2026-11-11T04:00:00.000Z");
    const twoIntervals = [
      start,
      new Date(start.getTime() + 2 * 60_000),
      new Date(start.getTime() + 4 * 60_000),
    ];
    const thin = computeRecentServicePace(twoIntervals, 5);
    assert.ok(thin.intervalCount < MIN_SERVE_INTERVALS);
    assert.equal(thin.source, "configured");
    assert.equal(thin.pace, 5);
  });

  it("averages positive inter-serve intervals once enough serves exist", () => {
    const start = new Date("2026-11-11T04:00:00.000Z");
    // 2, 2, 2 minute gaps — 4 serves, 3 intervals.
    const times = [0, 2, 4, 6].map((minutes) => new Date(start.getTime() + minutes * 60_000));
    const result = computeRecentServicePace(times, 3);
    assert.equal(result.source, "recent");
    assert.equal(result.pace, 2);
    assert.equal(result.intervalCount, 3);
    assert.equal(result.sampleSize, 4);
  });

  it("clamps a very fast or very slow sample to 0.5×–2× the configured average", () => {
    const start = new Date("2026-11-11T04:00:00.000Z");
    const fast = [0, 0.2, 0.4, 0.6].map((minutes) => new Date(start.getTime() + minutes * 60_000));
    const floored = computeRecentServicePace(fast, 4);
    assert.equal(floored.source, "recent");
    assert.equal(floored.pace, 2); // 0.5 × 4

    const slow = [0, 20, 40, 60].map((minutes) => new Date(start.getTime() + minutes * 60_000));
    const ceiled = computeRecentServicePace(slow, 4);
    assert.equal(ceiled.source, "recent");
    assert.equal(ceiled.pace, 8); // 2 × 4
  });

  it("ignores zero-length intervals so duplicate timestamps do not invent a pace", () => {
    const start = new Date("2026-11-11T04:00:00.000Z");
    const times = [0, 2, 2, 4, 6].map((minutes) => new Date(start.getTime() + minutes * 60_000));
    const result = computeRecentServicePace(times, 3);
    assert.equal(result.intervalCount, 3);
    assert.equal(result.source, "recent");
    assert.equal(result.pace, 2);
  });
});

describe("campusDayStart (clock seam)", () => {
  it("returns campus midnight for the frozen IST calendar day", () => {
    // 11 Nov 2026 00:30 IST is 10 Nov 2026 19:00 UTC.
    setNow("2026-11-10T19:00:00.000Z");
    const start = campusDayStart();
    assert.equal(start.toISOString(), "2026-11-10T18:30:00.000Z");
  });
});
