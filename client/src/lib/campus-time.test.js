import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  campusDatetimeLocalToIso,
  formatCampusDateTime,
  formatCampusClockTime,
  formatPaceLine,
  presentLiveEta,
} from "./campus-time.js";

describe("formatCampusDateTime (campus IST present)", () => {
  it("formats absolute campus clocks as day mon year, 12h + IST", () => {
    // 2026-08-10 08:35 UTC = 14:05 IST
    assert.equal(
      formatCampusDateTime("2026-08-10T08:35:00.000Z"),
      "10 Aug 2026, 2:05 PM IST"
    );
  });

  it("is independent of host timezone (fixed Asia/Kolkata)", () => {
    // 04:45 UTC = 10:15 IST on 9 Aug 2026
    assert.equal(
      formatCampusDateTime("2026-08-09T04:45:00.000Z"),
      "9 Aug 2026, 10:15 AM IST"
    );
  });

  it("returns em dash for empty values", () => {
    assert.equal(formatCampusDateTime(null), "—");
    assert.equal(formatCampusDateTime(undefined), "—");
    assert.equal(formatCampusDateTime(""), "—");
  });
});

describe("campusDatetimeLocalToIso", () => {
  it("treats datetime-local values as Asia/Kolkata wall time", () => {
    // 14:30 IST = 09:00 UTC
    assert.equal(
      campusDatetimeLocalToIso("2026-08-10T14:30"),
      "2026-08-10T09:00:00.000Z"
    );
  });

  it("returns null for empty input", () => {
    assert.equal(campusDatetimeLocalToIso(""), null);
    assert.equal(campusDatetimeLocalToIso(null), null);
  });
});

describe("formatCampusClockTime (ETA clock present)", () => {
  it("formats time-only campus clocks with trailing IST", () => {
    // 2026-08-10 08:35 UTC = 2:05 PM IST
    assert.equal(formatCampusClockTime("2026-08-10T08:35:00.000Z"), "2:05 PM IST");
  });

  it("returns em dash for empty values", () => {
    assert.equal(formatCampusClockTime(null), "—");
    assert.equal(formatCampusClockTime(""), "—");
  });
});

describe("formatPaceLine (length / pace from ETA inputs)", () => {
  it("explains people ahead and minutes each — no new ETA formula", () => {
    // position 1 = next → 0 ahead; avg 3
    assert.equal(formatPaceLine(1, 3), "0 ahead · ~3 min each");
    // position 3 → 2 ahead; gym avg 5
    assert.equal(formatPaceLine(3, 5), "2 ahead · ~5 min each");
  });

  it("returns null when inputs are not usable", () => {
    assert.equal(formatPaceLine(null, 3), null);
    assert.equal(formatPaceLine(2, null), null);
  });
});

describe("presentLiveEta (clock-primary; pause freeze)", () => {
  // asOf: 2026-08-10 08:00 UTC = 1:30 PM IST; +9 min → 1:39 PM IST
  const asOfMs = Date.parse("2026-08-10T08:00:00.000Z");

  it("presents campus-clock primary and minutes secondary when live", () => {
    const presented = presentLiveEta({
      etaMinutes: 9,
      asOfMs,
      paused: false,
    });
    assert.equal(presented.mode, "live");
    assert.equal(presented.primary, "~1:39 PM IST");
    assert.equal(presented.secondary, "9 min");
    assert.equal(presented.etaMinutes, 9);
  });

  it("freezes clock/minutes while Paused (does not keep advancing)", () => {
    const frozen = presentLiveEta({
      etaMinutes: 9,
      asOfMs,
      paused: true,
    });
    assert.equal(frozen.mode, "frozen");
    assert.equal(frozen.primary, "~1:39 PM IST");
    // Minutes stay as the last known estimate; secondary suppressed (pause honesty).
    assert.equal(frozen.secondary, null);
    assert.equal(frozen.etaMinutes, 9);

    // Caller must hold asOf while paused — later wall clock does not change primary.
    const stillFrozen = presentLiveEta({
      etaMinutes: 9,
      asOfMs,
      paused: true,
    });
    assert.equal(stillFrozen.primary, frozen.primary);
    assert.equal(stillFrozen.mode, "frozen");
  });

  it("live remaining-wait clock moves with asOf (caller passes wall now)", () => {
    const a = presentLiveEta({ etaMinutes: 6, asOfMs, paused: false });
    const b = presentLiveEta({
      etaMinutes: 6,
      asOfMs: asOfMs + 60_000,
      paused: false,
    });
    assert.notEqual(a.primary, b.primary);
  });
});
