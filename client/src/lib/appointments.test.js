import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campusDateOf, checkInState, formatBookingDay, formatBookingWhen, formatSlotTime, groupSlots } from "./appointments.js";

const slot = (hhmm) => ({ start: new Date(`2026-11-16T${hhmm}:00+05:30`).toISOString() });

describe("appointment helpers", () => {
  it("formats campus days and slot times regardless of the device time zone", () => {
    assert.equal(formatBookingDay("2026-11-16"), "Mon 16");
    assert.equal(formatSlotTime(slot("11:30").start), "11:30 AM");
    assert.equal(formatSlotTime(slot("19:05").start), "7:05 PM");
    assert.equal(campusDateOf("2026-11-15T20:00:00Z"), "2026-11-16");
    assert.equal(formatBookingWhen(slot("11:30").start), "Mon 16 · 11:30 AM");
  });

  it("groups slots into parts of the campus day", () => {
    const groups = groupSlots([slot("11:30"), slot("12:00"), slot("14:15"), slot("19:00")]);
    assert.deepEqual(groups.map((g) => [g.key, g.slots.length]), [
      ["morning", 1],
      ["afternoon", 2],
      ["evening", 1],
    ]);
  });

  it("reports when check-in is open", () => {
    const booking = {
      status: "booked",
      checkInOpensAt: "2026-11-16T05:45:00.000Z",
      checkInClosesAt: "2026-11-16T06:10:00.000Z",
    };
    assert.equal(checkInState(booking, Date.parse("2026-11-16T05:30:00Z")), "early");
    assert.equal(checkInState(booking, Date.parse("2026-11-16T06:00:00Z")), "open");
    assert.equal(checkInState(booking, Date.parse("2026-11-16T06:11:00Z")), "closed");
    assert.equal(checkInState({ ...booking, status: "checked-in" }), "in-line");
    assert.equal(checkInState(null), "closed");
  });
});
