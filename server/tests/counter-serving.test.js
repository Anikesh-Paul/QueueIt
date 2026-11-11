import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  completeCounterTurn,
  reconcileCounterServing,
  countersForJson,
} from "../src/services/counters.js";

function fakeQueue(counters) {
  return {
    nowServing: 8,
    counters: counters.map((counter, index) => ({
      _id: { toString: () => `c${index + 1}` },
      ...counter,
    })),
  };
}

describe("completeCounterTurn / reconcileCounterServing", () => {
  it("clears live nowServing after a serve and records lastServed", () => {
    const queue = fakeQueue([{ name: "Counter 1", nowServing: 8, lastServed: 3 }]);
    completeCounterTurn(queue, queue.counters[0], 8, { served: true });
    assert.equal(queue.counters[0].nowServing, null);
    assert.equal(queue.counters[0].lastServed, 8);
    assert.equal(queue.nowServing, 8);
    const json = countersForJson(queue);
    assert.equal(json[0].nowServing, null);
    assert.equal(json[0].lastServed, 8);
  });

  it("clears live nowServing after a skip without changing lastServed", () => {
    const queue = fakeQueue([{ name: "Counter 1", nowServing: 8, lastServed: 3 }]);
    completeCounterTurn(queue, queue.counters[0], 8, { served: false });
    assert.equal(queue.counters[0].nowServing, null);
    assert.equal(queue.counters[0].lastServed, 3);
    assert.equal(queue.nowServing, 8);
  });

  it("moves a stale nowServing onto lastServed when no one is being called", () => {
    const queue = fakeQueue([{ name: "Counter 1", nowServing: 8, lastServed: null }]);
    const mutated = reconcileCounterServing(queue, []);
    assert.equal(mutated, true);
    assert.equal(queue.counters[0].nowServing, null);
    assert.equal(queue.counters[0].lastServed, 8);
  });

  it("keeps a live token when a serving entry is at that counter", () => {
    const queue = fakeQueue([{ name: "Counter 1", nowServing: 8, lastServed: 3 }]);
    reconcileCounterServing(queue, [
      { status: "serving", servingCounterId: { toString: () => "c1" }, tokenNumber: 9 },
    ]);
    assert.equal(queue.counters[0].nowServing, 9);
  });
});
