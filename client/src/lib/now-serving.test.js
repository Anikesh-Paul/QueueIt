import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCatalogServing, presentCounterServing, presentServingBoard } from "./now-serving.js";

describe("presentCounterServing", () => {
  it("shows the live token as Now serving", () => {
    assert.deepEqual(presentCounterServing({ nowServing: 8, lastServed: 4 }), {
      label: "Now serving",
      value: "8",
      live: true,
      last: 4,
    });
  });

  it("shows Last served when the counter is free", () => {
    assert.deepEqual(presentCounterServing({ nowServing: null, lastServed: 8 }), {
      label: "Last served",
      value: "8",
      live: false,
      last: 8,
    });
  });

  it("shows an em dash when there is no history", () => {
    assert.equal(presentCounterServing({}).value, "—");
    assert.equal(presentCounterServing({}).live, false);
  });
});

describe("presentServingBoard", () => {
  it("relabels the board to Last served when every counter is free", () => {
    const board = presentServingBoard([
      { id: "a", name: "Counter 1", nowServing: null, lastServed: 8 },
      { id: "b", name: "Counter 2", nowServing: null, lastServed: 4 },
    ]);
    assert.equal(board.label, "Last served");
    assert.equal(board.multi, true);
    assert.equal(board.rows[0].value, "8");
    assert.equal(board.rows[1].value, "4");
  });

  it("keeps Now serving when any counter is calling someone", () => {
    const board = presentServingBoard([
      { id: "a", name: "Counter 1", nowServing: 9, lastServed: 8 },
      { id: "b", name: "Counter 2", nowServing: null, lastServed: 4 },
    ]);
    assert.equal(board.label, "Now serving");
    assert.equal(board.rows[0].value, "9");
    assert.equal(board.rows[1].label, "Last served");
  });

  it("treats a queue-level fallback token as last served, not live", () => {
    const board = presentServingBoard([], 6);
    assert.equal(board.label, "Last served");
    assert.equal(board.value, "6");
    assert.equal(board.rows[0].live, false);
  });
});

describe("formatCatalogServing", () => {
  it("shows a single counter as Now serving or Last served plus the token", () => {
    assert.equal(
      formatCatalogServing({ counters: [{ nowServing: 9, lastServed: 8 }] }),
      "Now serving 9"
    );
    assert.equal(
      formatCatalogServing({ counters: [{ nowServing: null, lastServed: 8 }] }),
      "Last served 8"
    );
    assert.equal(formatCatalogServing({ counters: [{}] }), "Now serving —");
  });

  it("names each counter when a queue has more than one", () => {
    assert.equal(
      formatCatalogServing({
        counters: [
          { id: "a", name: "Counter 1", nowServing: null, lastServed: 8 },
          { id: "b", name: "Counter 2", nowServing: null, lastServed: 4 },
        ],
      }),
      "Last served Counter 1 8, Counter 2 4"
    );
    assert.equal(
      formatCatalogServing({
        counters: [
          { id: "a", name: "Counter 1", nowServing: 9, lastServed: 8 },
          { id: "b", name: "Counter 2", nowServing: null, lastServed: 4 },
        ],
      }),
      "Now serving Counter 1 9, Counter 2 last served 4"
    );
  });
});
