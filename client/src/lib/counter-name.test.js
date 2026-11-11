import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextCounterPlaceholder } from "./counter-name.js";

describe("nextCounterPlaceholder", () => {
  it("starts at Counter 1 when the list is empty", () => {
    assert.equal(nextCounterPlaceholder([]), "Counter 1");
  });

  it("skips names that already exist, including Counter 2", () => {
    assert.equal(
      nextCounterPlaceholder([{ name: "Counter 1" }, { name: "Counter 2" }]),
      "Counter 3"
    );
    assert.equal(
      nextCounterPlaceholder([{ name: "counter 1" }, { name: "Window A" }]),
      "Counter 2"
    );
  });
});
