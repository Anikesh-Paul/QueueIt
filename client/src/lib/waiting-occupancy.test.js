import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatWaitingOccupancy } from "./waiting-occupancy.js";

describe("formatWaitingOccupancy", () => {
  it("always shows the waiting count, and No one waiting when the line is empty", () => {
    assert.equal(formatWaitingOccupancy({ waitingCount: 3 }), "3 waiting");
    assert.equal(formatWaitingOccupancy({ waitingCount: 3, maxWaiting: null }), "3 waiting");
    assert.equal(formatWaitingOccupancy({ waitingCount: 0 }), "No one waiting");
    assert.equal(formatWaitingOccupancy({}), "No one waiting");
  });

  it("never uses a current/cap fraction, even when occupancy is above the cap", () => {
    assert.equal(
      formatWaitingOccupancy({ waitingCount: 3, maxWaiting: 5 }),
      "3 waiting · cap 5"
    );
    assert.equal(
      formatWaitingOccupancy({ waitingCount: 3, maxWaiting: 1 }),
      "3 waiting · cap 1"
    );
    assert.equal(
      formatWaitingOccupancy({ waitingCount: 0, maxWaiting: 10 }),
      "No one waiting · cap 10"
    );
    assert.equal(
      formatWaitingOccupancy({ waitingCount: 3, maxWaiting: 1 }).includes("/"),
      false
    );
  });
});
