import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateServiceExceptions,
  normalizeServiceExceptions,
  resolveTargetWindow,
  nextWindowStartAfter,
} from "../src/services/serviceWindows.js";

const WEEKLY = [
  { start: "11:30", end: "14:30" },
  { start: "19:00", end: "21:00" },
];

/** Monday 10 Aug 2026, cafeteria lunch day. */
const MONDAY_LUNCH = new Date("2026-08-10T12:00:00+05:30");
const MONDAY_MORNING = new Date("2026-08-10T10:00:00+05:30");
const MONDAY_AFTERNOON = new Date("2026-08-10T15:00:00+05:30");
const TUESDAY_LUNCH_END = "2026-08-11T14:30:00+05:30";
const TUESDAY_LUNCH_START = "2026-08-11T11:30:00+05:30";

describe("validate + normalize service exceptions", () => {
  it("accepts a closed day and alternate hours", () => {
    const result = validateServiceExceptions([
      { date: "2026-08-10", closed: true },
      { date: "2026-08-11", windows: [{ start: "10:00", end: "13:00" }] },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.exceptions, [
      { date: "2026-08-10", closed: true },
      { date: "2026-08-11", closed: false, windows: [{ start: "10:00", end: "13:00" }] },
    ]);
    assert.deepEqual(normalizeServiceExceptions(result.exceptions), result.exceptions);
  });

  it("rejects a bad date, a duplicate, and closed-plus-hours", () => {
    assert.equal(validateServiceExceptions([{ date: "2026-02-31", closed: true }]).ok, false);
    assert.equal(
      validateServiceExceptions([
        { date: "2026-08-10", closed: true },
        { date: "2026-08-10", windows: [{ start: "10:00", end: "12:00" }] },
      ]).ok,
      false
    );
    const closedHours = validateServiceExceptions([
      { date: "2026-08-10", closed: true, windows: [{ start: "10:00", end: "12:00" }] },
    ]);
    assert.equal(closedHours.ok, false);
    assert.match(closedHours.error, /cannot include hours/i);
  });
});

describe("exception dates override weekly windows (clock seam)", () => {
  it("on a closed holiday, binds the next regular day instead of today's lunch", () => {
    const exceptions = [{ date: "2026-08-10", closed: true }];
    const target = resolveTargetWindow(WEEKLY, MONDAY_LUNCH, exceptions);
    assert.ok(target);
    assert.equal(target.window.start, "11:30");
    assert.equal(target.sessionEndsAt.toISOString(), new Date(TUESDAY_LUNCH_END).toISOString());
    assert.equal(
      nextWindowStartAfter(WEEKLY, MONDAY_MORNING, exceptions).toISOString(),
      new Date(TUESDAY_LUNCH_START).toISOString()
    );
  });

  it("alternate hours replace the whole day, including dinner", () => {
    const exceptions = [
      { date: "2026-08-10", windows: [{ start: "10:00", end: "13:00" }] },
    ];
    const during = resolveTargetWindow(WEEKLY, new Date("2026-08-10T11:00:00+05:30"), exceptions);
    assert.equal(during.window.start, "10:00");
    assert.equal(
      during.sessionEndsAt.toISOString(),
      new Date("2026-08-10T13:00:00+05:30").toISOString()
    );
    const after = resolveTargetWindow(WEEKLY, MONDAY_AFTERNOON, exceptions);
    assert.equal(after.window.start, "11:30");
    assert.equal(after.sessionEndsAt.toISOString(), new Date(TUESDAY_LUNCH_END).toISOString());
  });

  it("a closed next morning truncates an overnight window at campus midnight", () => {
    const weekly = [{ start: "22:00", end: "02:00" }];
    const exceptions = [{ date: "2026-08-11", closed: true }];
    const during = resolveTargetWindow(weekly, new Date("2026-08-10T23:00:00+05:30"), exceptions);
    assert.ok(during);
    assert.equal(
      during.sessionEndsAt.toISOString(),
      new Date("2026-08-11T00:00:00+05:30").toISOString()
    );
    const morning = resolveTargetWindow(weekly, new Date("2026-08-11T01:00:00+05:30"), exceptions);
    assert.equal(
      morning.sessionEndsAt.toISOString(),
      new Date("2026-08-13T02:00:00+05:30").toISOString()
    );
  });
});
