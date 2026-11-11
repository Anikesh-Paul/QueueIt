import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campusTodayDateString, describeTodayException } from "./service-exceptions.js";

describe("describeTodayException", () => {
  const monday = new Date("2026-08-10T12:00:00+05:30");

  it("uses the campus calendar date, not UTC", () => {
    // 11 Aug 2026 00:30 IST is still 10 Aug 19:00 UTC.
    const late = new Date("2026-08-10T19:00:00Z");
    assert.equal(campusTodayDateString(late), "2026-08-11");
  });

  it("describes a closed holiday and alternate hours for today only", () => {
    assert.equal(
      describeTodayException([{ date: "2026-08-10", closed: true }], monday),
      "Closed today (holiday hours)."
    );
    assert.equal(
      describeTodayException(
        [{ date: "2026-08-10", closed: false, windows: [{ start: "10:00", end: "13:00" }] }],
        monday
      ),
      "Holiday hours today: 10:00–13:00 IST."
    );
    assert.equal(
      describeTodayException([{ date: "2026-08-15", closed: true }], monday),
      null
    );
  });
});
