import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDays,
  normalizeServiceWindows,
  validateServiceWindows,
  resolveTargetWindow,
  nextWindowStartAfter,
  getCampusWeekday,
} from "../src/services/serviceWindows.js";

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

/** Friday 14:00 IST 14 Aug 2026; Saturday 10:00 IST 15 Aug 2026. */
const FRIDAY_AFTERNOON = new Date("2026-08-14T14:00:00+05:30");
const FRIDAY_AFTER_LUNCH = new Date("2026-08-14T14:31:00+05:30");
const SATURDAY_MORNING = new Date("2026-08-15T10:00:00+05:30");
const SATURDAY_EVENING = new Date("2026-08-15T18:00:00+05:30");
const SUNDAY_EVENING = new Date("2026-08-16T18:00:00+05:30");
const MONDAY_MORNING = new Date("2026-08-17T09:00:00+05:30");

describe("normalizeDays", () => {
  it("treats missing, empty, or all-seven as every day", () => {
    assert.equal(normalizeDays(undefined), null);
    assert.equal(normalizeDays([]), null);
    assert.equal(normalizeDays("every"), null);
    assert.deepEqual(normalizeDays([0, 1, 2, 3, 4, 5, 6]), null);
  });

  it("accepts weekdays/weekend presets and 0–6 arrays", () => {
    assert.deepEqual(normalizeDays("mon-fri"), WEEKDAYS);
    assert.deepEqual(normalizeDays("1-5"), WEEKDAYS);
    assert.deepEqual(normalizeDays("weekdays"), WEEKDAYS);
    assert.deepEqual(normalizeDays("weekend"), WEEKEND);
    assert.deepEqual(normalizeDays("sat-sun"), WEEKEND);
    assert.deepEqual(normalizeDays([5, 1, 1]), [1, 5]);
  });
});

describe("validate + normalize keep every-day windows and allow split schedules", () => {
  it("still accepts a classic every-day pair", () => {
    const result = validateServiceWindows([
      { start: "11:30", end: "14:30" },
      { start: "19:00", end: "21:00" },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.windows, [
      { start: "11:30", end: "14:30" },
      { start: "19:00", end: "21:00" },
    ]);
  });

  it("allows the same clock times on weekdays and weekends", () => {
    const result = validateServiceWindows([
      { start: "11:30", end: "14:30", days: "weekdays" },
      { start: "11:30", end: "14:30", days: "weekend" },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.windows.length, 2);
  });

  it("rejects overlapping times that share a day", () => {
    const result = validateServiceWindows([
      { start: "11:00", end: "14:00" },
      { start: "13:00", end: "15:00", days: "weekdays" },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /overlap/i);
  });

  it("omits days from normalized every-day rows", () => {
    const rows = normalizeServiceWindows([{ start: "17:00", end: "21:00" }]);
    assert.deepEqual(rows, [{ start: "17:00", end: "21:00" }]);
  });
});

describe("target bind and reopen use the next matching day", () => {
  const schedule = [
    { start: "11:30", end: "14:30", days: WEEKDAYS },
    { start: "10:00", end: "13:00", days: WEEKEND },
  ];

  it("knows Friday and Saturday campus weekdays", () => {
    assert.equal(getCampusWeekday(FRIDAY_AFTERNOON), 5);
    assert.equal(getCampusWeekday(SATURDAY_MORNING), 6);
  });

  it("after weekday lunch has ended, binds the weekend morning window — not Monday lunch", () => {
    const target = resolveTargetWindow(schedule, FRIDAY_AFTER_LUNCH);
    assert.ok(target);
    assert.equal(target.window.start, "10:00");
    assert.deepEqual(target.window.days, WEEKEND);
    assert.equal(target.sessionEndsAt.toISOString(), new Date("2026-08-15T13:00:00+05:30").toISOString());
  });

  it("on Saturday evening, reopen is Sunday's weekend morning — not Monday lunch", () => {
    const reopen = nextWindowStartAfter(schedule, SATURDAY_EVENING);
    assert.ok(reopen);
    assert.equal(reopen.toISOString(), new Date("2026-08-16T10:00:00+05:30").toISOString());
  });

  it("on Sunday evening, still reopens Monday morning, skipping the rest of the weekend", () => {
    const reopen = nextWindowStartAfter(schedule, SUNDAY_EVENING);
    assert.equal(reopen.toISOString(), new Date("2026-08-17T11:30:00+05:30").toISOString());
  });

  it("Monday morning still binds the weekday lunch window", () => {
    const target = resolveTargetWindow(schedule, MONDAY_MORNING);
    assert.equal(target.window.start, "11:30");
    assert.deepEqual(target.window.days, WEEKDAYS);
    assert.equal(target.sessionEndsAt.toISOString(), new Date("2026-08-17T14:30:00+05:30").toISOString());
  });

  it("every-day schedules still bind today then tomorrow as before", () => {
    const daily = [{ start: "11:30", end: "14:30" }];
    const friday = resolveTargetWindow(daily, FRIDAY_AFTERNOON);
    // 14:00 is after 14:30? Friday 14:00 is before 14:30 end, so same-day lunch.
    assert.equal(friday.window.start, "11:30");
    assert.equal(friday.sessionEndsAt.toISOString(), new Date("2026-08-14T14:30:00+05:30").toISOString());
    const saturdayEvening = resolveTargetWindow(daily, SATURDAY_EVENING);
    assert.equal(
      saturdayEvening.sessionEndsAt.toISOString(),
      new Date("2026-08-16T14:30:00+05:30").toISOString()
    );
  });
});
