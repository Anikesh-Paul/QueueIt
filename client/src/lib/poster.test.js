import { test } from "node:test";
import assert from "node:assert/strict";
import { displayLink, formatClock, formatDays, formatServiceHours } from "./poster.js";

test("clock and day formatting", () => {
  assert.equal(formatClock("09:00"), "9:00 AM");
  assert.equal(formatClock("12:30"), "12:30 PM");
  assert.equal(formatClock("00:15"), "12:15 AM");
  assert.equal(formatClock("bad"), "bad");
  assert.equal(formatDays(null), "Daily");
  assert.equal(formatDays([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(formatDays([0, 6]), "Sat–Sun");
  assert.equal(formatDays([1, 3, 5]), "Mon, Wed, Fri");
});

test("service hours group by day set", () => {
  assert.deepEqual(
    formatServiceHours([
      { start: "11:30", end: "14:30" },
      { start: "19:00", end: "21:00" },
    ]),
    ["Daily · 11:30 AM – 2:30 PM, 7:00 PM – 9:00 PM"]
  );
  assert.deepEqual(
    formatServiceHours([
      { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      { start: "10:00", end: "13:00", days: [0, 6] },
    ]),
    ["Mon–Fri · 9:00 AM – 5:00 PM", "Sat–Sun · 10:00 AM – 1:00 PM"]
  );
  assert.deepEqual(formatServiceHours([]), []);
});

test("display link strips protocol and query", () => {
  assert.equal(displayLink("https://queueit-seven.vercel.app/join/abc?src=qr"), "queueit-seven.vercel.app/join/abc");
  assert.equal(displayLink(""), "");
});
