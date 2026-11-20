import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  barHeights,
  busiestHour,
  campusWeekday,
  hourLabel,
  levelKey,
  nowBadge,
  recommendedHour,
  visibleHours,
  weekdayName,
} from "./best-time.js";
import { MESSAGES } from "./i18n.js";

const hours = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  open: hour >= 9 && hour < 17,
  samples: hour === 9 ? 18 : hour === 12 ? 3 : hour === 19 ? 2 : 0,
  crowd: hour === 9 ? 6 : hour === 12 ? 1 : hour === 19 ? 0.7 : 0,
}));

describe("best time helpers", () => {
  it("uses the campus weekday", () => {
    // 20 Nov 2026 19:00 UTC is already Saturday 00:30 in IST.
    assert.equal(campusWeekday(new Date("2026-11-20T19:00:00Z")), 6);
    assert.equal(campusWeekday(new Date("2026-11-20T10:00:00Z")), 5);
  });

  it("names weekdays and hours per locale", () => {
    assert.equal(weekdayName(1, "en"), "Mon");
    assert.equal(weekdayName(0, "en", "long"), "Sunday");
    assert.notEqual(weekdayName(1, "hi"), "Mon");
    assert.match(hourLabel(15, "en"), /3\s?PM/i);
    assert.match(hourLabel(0, "en"), /12\s?AM/i);
  });

  it("trims the axis to open hours or hours with tickets", () => {
    const shown = visibleHours(hours);
    assert.equal(shown[0].hour, 9);
    assert.equal(shown.at(-1).hour, 19);
    assert.deepEqual(visibleHours([]), []);
  });

  it("builds the now badge", () => {
    assert.equal(nowBadge(null), null);
    assert.equal(nowBadge({ open: false, level: null }), null);
    assert.deepEqual(nowBadge({ open: true, level: "quiet" }), { key: "bestTime.nowQuiet", tone: "quiet" });
    assert.equal(nowBadge({ open: true, level: "busy" }).key, "bestTime.nowBusy");
    assert.equal(nowBadge({ open: true, level: "moderate" }).key, "bestTime.nowSteady");
  });

  it("finds the busiest open hour and the recommendation", () => {
    assert.equal(busiestHour(hours).hour, 9);
    assert.equal(recommendedHour({ enough: true, best: { hour: 12 }, nextBest: { hour: 15 } }).hour, 15);
    assert.equal(recommendedHour({ enough: true, best: { hour: 12 }, nextBest: null }).hour, 12);
    assert.equal(recommendedHour({ enough: false }), null);
  });

  it("scales bars", () => {
    assert.deepEqual(barHeights([{ crowd: 6 }, { crowd: 3 }, { crowd: 0 }, { crowd: 0.01 }], 60), [60, 30, 0, 2]);
  });

  it("uses keys that exist", () => {
    for (const level of ["quiet", "moderate", "busy", null]) assert.ok(MESSAGES.en[levelKey(level)]);
    for (const level of ["quiet", "moderate", "busy"]) assert.ok(MESSAGES.en[nowBadge({ open: true, level }).key]);
  });
});
