import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LANDING_STRIP_LIMIT, landingStripItems, tickValue } from "./landing.js";

const venue = { id: "v1", name: "Campus Hub" };

describe("landingStripItems", () => {
  it("maps status-board queues to strip cards with whole-minute waits", () => {
    const items = landingStripItems([
      { id: "a", name: "Cafeteria", venue, status: "open", waitingCount: 3, waitEstimate: { low: 4, high: 7.6 } },
    ]);
    assert.deepEqual(items, [
      { id: "a", name: "Cafeteria", place: "Campus Hub", state: "open", minutes: 8, waiting: 3 },
    ]);
  });

  it("reports zero minutes for an empty line and null when there is no estimate", () => {
    const [empty, unknown] = landingStripItems([
      { id: "a", name: "A", venue, waitingCount: 0, waitEstimate: { low: 0, high: 0, source: "empty" } },
      { id: "b", name: "B", venue, waitingCount: 2 },
    ]);
    assert.equal(empty.minutes, 0);
    assert.equal(unknown.minutes, null);
  });

  it("puts open queues first, then paused, then closed, by name within each", () => {
    const items = landingStripItems([
      { id: "1", name: "Library", acceptingTokens: false },
      { id: "2", name: "Gym", status: "paused" },
      { id: "3", name: "Cafeteria", status: "open" },
      { id: "4", name: "Admissions", status: "open" },
    ]);
    assert.deepEqual(items.map((q) => [q.name, q.state]), [
      ["Admissions", "open"],
      ["Cafeteria", "open"],
      ["Gym", "paused"],
      ["Library", "closed"],
    ]);
  });

  it(`keeps at most ${LANDING_STRIP_LIMIT} queues and tolerates bad input`, () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: `Q${i}` }));
    assert.equal(landingStripItems(many).length, LANDING_STRIP_LIMIT);
    assert.deepEqual(landingStripItems(null), []);
    assert.deepEqual(landingStripItems([null, { name: "x" }]), []);
  });

  it("clamps negative counts to zero", () => {
    const [item] = landingStripItems([{ id: "a", name: "A", waitingCount: -2, waitEstimate: { high: -1 } }]);
    assert.equal(item.waiting, 0);
    assert.equal(item.minutes, 0);
  });
});

describe("tickValue", () => {
  it("starts at zero and lands exactly on the target", () => {
    assert.equal(tickValue(12, 0), 0);
    assert.equal(tickValue(12, 1), 12);
  });

  it("eases out: more than half way at the half-time mark, never past the target", () => {
    const mid = tickValue(100, 0.5);
    assert.ok(mid > 50 && mid < 100, `mid was ${mid}`);
    assert.equal(tickValue(100, 1.7), 100);
    assert.equal(tickValue(100, -1), 0);
  });

  it("returns whole numbers and passes through non-numbers as null", () => {
    assert.ok(Number.isInteger(tickValue(7, 0.33)));
    assert.equal(tickValue(null, 0.5), null);
  });
});
