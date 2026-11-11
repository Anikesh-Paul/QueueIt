import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  barPercent,
  campusDate,
  daysBetween,
  formatHour,
  formatMinutes,
  formatRate,
  formatShortDate,
  labelStride,
  niceMax,
  presetRange,
  reportQuery,
  validateRange,
} from "./analytics-report.js";

test("campusDate follows IST, not UTC", () => {
  assert.equal(campusDate(new Date("2026-11-11T18:29:59Z")), "2026-11-11");
  assert.equal(campusDate(new Date("2026-11-11T18:30:00Z")), "2026-11-12");
});

test("presets end today in campus time", () => {
  const at = new Date("2026-11-12T03:00:00Z");
  assert.deepEqual(presetRange("today", at), { from: "2026-11-12", to: "2026-11-12" });
  assert.deepEqual(presetRange("7d", at), { from: "2026-11-06", to: "2026-11-12" });
  assert.deepEqual(presetRange("30d", at), { from: "2026-10-14", to: "2026-11-12" });
  assert.deepEqual(presetRange("unknown", at), { from: "2026-11-06", to: "2026-11-12" });
});

test("date arithmetic and range validation", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-11-01", "2026-11-01"), 1);
  assert.equal(daysBetween("2026-11-05", "2026-11-01"), 0);
  assert.equal(validateRange("2026-11-01", "2026-11-07"), "");
  assert.match(validateRange("2026-11-07", "2026-11-01"), /on or before/);
  assert.match(validateRange("2026-01-01", "2026-11-01"), /92 days/);
  assert.match(validateRange("", "2026-11-01"), /Pick a start/);
  assert.match(validateRange("2026-02-30", "2026-03-01"), /Pick a start/);
});

test("report query omits empty filters", () => {
  assert.equal(reportQuery({ from: "2026-11-01", to: "2026-11-07" }), "from=2026-11-01&to=2026-11-07");
  assert.equal(reportQuery({ from: "a", to: "b", venueId: "v1", queueId: "" }), "from=a&to=b&venueId=v1");
});

test("formatting", () => {
  assert.equal(formatRate(null), "—");
  assert.equal(formatRate(0), "0%");
  assert.equal(formatRate(0.05), "5.0%");
  assert.equal(formatRate(0.333), "33%");
  assert.equal(formatMinutes(null), "—");
  assert.equal(formatMinutes(0.4), "<1 min");
  assert.equal(formatMinutes(7.3), "7.3 min");
  assert.equal(formatMinutes(12), "12 min");
  assert.equal(formatMinutes(95), "1 h 35 min");
  assert.equal(formatHour(0), "12 AM");
  assert.equal(formatHour(13), "1 PM");
  assert.equal(formatHour(null), "—");
  assert.equal(formatShortDate("2026-11-09", 2026), "9 Nov");
  assert.equal(formatShortDate("2025-12-31", 2026), "31 Dec 2025");
});

test("chart scaling", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(13), 20);
  assert.equal(niceMax(100), 100);
  assert.equal(barPercent(0, 10), 0);
  assert.equal(barPercent(5, 10), 50);
  assert.equal(barPercent(0.01, 100), 2);
  assert.equal(labelStride(7), 1);
  assert.equal(labelStride(30), 4);
});
