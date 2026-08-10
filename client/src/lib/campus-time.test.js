import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  campusDatetimeLocalToIso,
  formatCampusDateTime,
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
