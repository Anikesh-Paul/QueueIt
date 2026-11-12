import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideLeaveNotification, leaveCopy, liveLeave, travelLabel } from "./leave-alert.js";

describe("leave alert", () => {
  const base = Date.parse("2026-11-13T06:00:00Z");

  it("counts down from leaveAt between polls", () => {
    const leave = { state: "later", leaveInMinutes: 12, leaveAt: "2026-11-13T06:12:00Z" };
    assert.equal(liveLeave(leave, base).state, "later");
    assert.equal(liveLeave(leave, base + 8 * 60_000).state, "soon");
    assert.equal(liveLeave(leave, base + 8 * 60_000).leaveInMinutes, 4);
    assert.equal(liveLeave(leave, base + 12 * 60_000).state, "now");
    assert.deepEqual(liveLeave({ state: "paused" }, base), { state: "paused" });
    assert.equal(liveLeave(null, base), null);
  });

  it("writes plain copy for each state", () => {
    const now = leaveCopy({ leave: { state: "now" }, etaMinutes: 8, travelMinutes: 10 });
    assert.equal(now.title, "Time to head over");
    assert.match(now.body, /8 min/);
    assert.match(now.body, /10 min/);
    const later = leaveCopy({ leave: { state: "later", leaveInMinutes: 25 }, clock: "12:40 PM" });
    assert.equal(later.title, "Leave at 12:40 PM");
    assert.equal(leaveCopy({ leave: { state: "called" } }), null);
    assert.equal(travelLabel(0), "I'm nearby");
    assert.equal(travelLabel(15), "15 min");
  });

  it("fires once per token, and not for the person at the front", () => {
    const leave = { state: "now" };
    const first = decideLeaveNotification({ leave, position: 4, queueId: "q", tokenNumber: 9 });
    assert.equal(first.fire, true);
    const again = decideLeaveNotification({ leave, position: 3, queueId: "q", tokenNumber: 9, lastKey: first.lastKey });
    assert.equal(again.fire, false);
    assert.equal(decideLeaveNotification({ leave, position: 1, queueId: "q", tokenNumber: 9 }).fire, false);
    assert.equal(decideLeaveNotification({ leave: { state: "soon" }, position: 5, queueId: "q" }).fire, false);
  });
});
