import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatWaitingOccupancy } from "./waiting-occupancy.js";

describe("formatWaitingOccupancy", () => {
  it("returns an empty string when there is no cap", () => {
    assert.equal(formatWaitingOccupancy({ waitingCount: 3 }), "");
    assert.equal(formatWaitingOccupancy({ waitingCount: 3, maxWaiting: null }), "");
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
      formatWaitingOccupancy({ waitingCount: 3, maxWaiting: 1 }).includes("/"),
      false
    );
  });
});
