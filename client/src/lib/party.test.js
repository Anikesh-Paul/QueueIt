import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampPartySize, extraPercent, groupsOf, partyOptions, partySizeOf, peopleOn, reduceOptions } from "./party.js";

describe("party helpers", () => {
  it("defaults older tickets to one person", () => {
    assert.equal(partySizeOf({}), 1);
    assert.equal(partySizeOf({ partySize: 3 }), 3);
    assert.equal(partySizeOf({ partySize: 9 }), 4);
    assert.equal(peopleOn([{ partySize: 3 }, {}, { partySize: 2 }]), 6);
  });

  it("reads queue group settings", () => {
    assert.deepEqual(groupsOf({}), { enabled: false, maxSize: 1, extraPerPerson: 0.5 });
    assert.deepEqual(groupsOf({ groups: { enabled: true, maxSize: 3, extraPerPerson: 0.25 } }), { enabled: true, maxSize: 3, extraPerPerson: 0.25 });
    assert.deepEqual(partyOptions({ groups: { enabled: true, maxSize: 4 } }), [1, 2, 3, 4]);
    assert.deepEqual(partyOptions({ groups: { enabled: false, maxSize: 1 } }), [1]);
  });

  it("clamps picks and lists smaller sizes", () => {
    assert.equal(clampPartySize(4, { groups: { enabled: true, maxSize: 2 } }), 2);
    assert.equal(clampPartySize("x", {}), 1);
    assert.deepEqual(reduceOptions(3), [1, 2]);
    assert.deepEqual(reduceOptions(1), []);
    assert.equal(extraPercent(0.25), 25);
  });
});
