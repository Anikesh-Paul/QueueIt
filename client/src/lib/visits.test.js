import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatWait,
  hasActiveFilters,
  outcomeKey,
  pageList,
  rangeError,
  readVisitFilters,
  sortWithFavorites,
  visitAsRateable,
  visitFilterParams,
} from "./visits.js";
import { MESSAGES } from "./i18n.js";

const fakeT = (key, vars = {}) => `${key}:${JSON.stringify(vars)}`;
const ID_A = "a".repeat(24);

describe("visits helpers", () => {
  it("pins starred queues to the top in star order, others keep order", () => {
    const queues = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
    assert.deepEqual(sortWithFavorites(queues, ["3", "1"]).map((q) => q.id), ["3", "1", "2", "4"]);
    assert.deepEqual(sortWithFavorites(queues, []).map((q) => q.id), ["1", "2", "3", "4"]);
    assert.deepEqual(sortWithFavorites(queues, ["gone"]).map((q) => q.id), ["1", "2", "3", "4"]);
    assert.deepEqual(sortWithFavorites(null, ["1"]), []);
  });

  it("reads filters from the URL and drops bad values", () => {
    const good = readVisitFilters(new URLSearchParams(`queue=${ID_A}&from=2026-11-01&to=2026-11-20&page=3`));
    assert.deepEqual(good, { queue: ID_A, from: "2026-11-01", to: "2026-11-20", page: 3 });
    const bad = readVisitFilters(new URLSearchParams("queue=x&from=1/1/26&page=-2"));
    assert.deepEqual(bad, { queue: "", from: "", to: "", page: 1 });
  });

  it("builds params without empty values", () => {
    assert.equal(visitFilterParams({ queue: "", from: "2026-11-01", page: 1 }).toString(), "from=2026-11-01");
    assert.equal(visitFilterParams({ page: 2 }, { pageSize: 10 }).toString(), "page=2&pageSize=10");
  });

  it("flags a backwards range and active filters", () => {
    assert.equal(rangeError({ from: "2026-11-20", to: "2026-11-01" }), true);
    assert.equal(rangeError({ from: "2026-11-01", to: "2026-11-01" }), false);
    assert.equal(hasActiveFilters({}), false);
    assert.equal(hasActiveFilters({ from: "2026-11-01" }), true);
  });

  it("formats waits", () => {
    assert.equal(formatWait(null, fakeT), null);
    assert.equal(formatWait(0, fakeT), "visits.waitUnderMinute:{}");
    assert.equal(formatWait(12, fakeT), 'visits.waitMinutes:{"minutes":12}');
    assert.equal(formatWait(65, fakeT), 'visits.waitHoursMinutes:{"hours":1,"minutes":5}');
    assert.equal(formatWait(120, fakeT), 'visits.waitHours:{"hours":2}');
  });

  it("builds a compact page list", () => {
    assert.deepEqual(pageList(1, 1), [1]);
    assert.deepEqual(pageList(1, 3), [1, 2, 3]);
    assert.deepEqual(pageList(5, 10), [1, null, 4, 5, 6, null, 10]);
    assert.deepEqual(pageList(99, 4), [1, null, 3, 4]);
  });

  it("maps outcomes to keys that exist in English", () => {
    for (const outcome of ["served", "no-show", "skipped", "left", "active", "weird"]) {
      assert.ok(MESSAGES.en[outcomeKey(outcome)], outcome);
    }
  });

  it("shapes a visit for the rating helpers", () => {
    assert.deepEqual(visitAsRateable({ status: "served", endedAt: "x", feedback: null }), {
      status: "served",
      feedback: null,
      updatedAt: "x",
    });
  });
});
