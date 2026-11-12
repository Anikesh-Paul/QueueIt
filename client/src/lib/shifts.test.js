import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { counterActions, effectivePace, staffingSummary } from "./shifts.js";

describe("shift helpers", () => {
  it("offers the right actions per counter", () => {
    const me = "u1";
    assert.deepEqual(counterActions({ state: "open", staffedBy: { id: "u1" } }, { meId: me, onShift: true }), ["break", "end"]);
    assert.deepEqual(counterActions({ state: "break", staffedBy: { id: "u1" } }, { meId: me, onShift: true }), ["back", "end"]);
    assert.deepEqual(counterActions({ state: "open", staffedBy: { id: "u2" } }, { meId: me }), []);
    assert.deepEqual(counterActions({ state: "open", staffedBy: null }, { meId: me, onShift: false }), ["start", "close"]);
    assert.deepEqual(counterActions({ state: "closed", staffedBy: null }, { meId: me, onShift: true }), ["open"]);
  });
  it("summarises staffing and pace", () => {
    assert.equal(staffingSummary({ countersOpen: 1, countersTotal: 2 }), "1 of 2 counters open");
    assert.equal(staffingSummary({ countersOpen: 2, countersTotal: 2 }), "All 2 counters open");
    assert.equal(staffingSummary({ countersOpen: 0, countersTotal: 1 }), "Counter closed");
    assert.equal(effectivePace({ averageServiceTime: 4, countersOpen: 1, countersTotal: 2 }), 8);
    assert.equal(effectivePace({ averageServiceTime: 4, countersOpen: 0, countersTotal: 2 }), 8);
  });
});
