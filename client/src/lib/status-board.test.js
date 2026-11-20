import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boardLastUpdated,
  boardPollMs,
  boardWaitCopy,
  groupStatusBoard,
  parseStatusBoardParams,
  statusBoardPath,
  statusBoardUrl,
} from "./status-board.js";

const cafe = {
  id: "1",
  name: "Cafeteria",
  organization: { id: "default", slug: "main", name: "Main campus" },
  venue: { id: "v1", slug: "campus-hub", name: "Campus Hub" },
};
const gym = {
  id: "2",
  name: "Gym",
  organization: { id: "default", slug: "main", name: "Main campus" },
  venue: { id: "v1", slug: "campus-hub", name: "Campus Hub" },
};
const pharmacy = {
  id: "3",
  name: "Pharmacy",
  organization: { id: "o2", slug: "city-annex", name: "City Annex" },
  venue: { id: "v2", slug: "outpatient", name: "Outpatient" },
};

describe("status board helpers", () => {
  it("builds a stable shareable path and parses it back", () => {
    assert.equal(statusBoardPath(), "/status-board");
    assert.equal(statusBoardPath({}), "/status-board");
    assert.equal(statusBoardPath({ org: "main" }), "/status-board?org=main");
    assert.equal(statusBoardPath({ venue: "campus-hub" }), "/status-board?venue=campus-hub");
    assert.equal(
      statusBoardPath({ org: "city-annex", venue: "outpatient" }),
      "/status-board?org=city-annex&venue=outpatient"
    );
    assert.deepEqual(parseStatusBoardParams(""), { org: null, venue: null });
    assert.deepEqual(parseStatusBoardParams("?org=main&venue=campus-hub"), {
      org: "main",
      venue: "campus-hub",
    });
    assert.equal(statusBoardUrl("https://queueit.example", { venue: "campus-hub" }), "https://queueit.example/status-board?venue=campus-hub");
    assert.equal(statusBoardUrl("not-a-url"), null);
  });

  it("groups by organization then venue, and hides org headings for a single campus", () => {
    const one = groupStatusBoard([gym, cafe]);
    assert.equal(one.showOrgHeadings, false);
    assert.equal(one.groups.length, 1);
    assert.equal(one.groups[0].venues.length, 1);
    assert.deepEqual(
      one.groups[0].venues[0].queues.map((q) => q.name),
      ["Cafeteria", "Gym"]
    );

    const two = groupStatusBoard([pharmacy, cafe]);
    assert.equal(two.showOrgHeadings, true);
    assert.deepEqual(
      two.groups.map((g) => g.org.name),
      ["City Annex", "Main campus"]
    );
    assert.equal(two.groups[0].venues[0].venue.name, "Outpatient");
  });

  it("reuses catalog wait language, including empty and low-confidence states", () => {
    assert.deepEqual(boardWaitCopy({ low: 4, high: 9 }), { wait: "Wait about 4–9 min", confidence: null });
    assert.deepEqual(boardWaitCopy({ low: 0, high: 0, source: "empty" }), {
      wait: "Little or no wait",
      confidence: null,
    });
    assert.deepEqual(boardWaitCopy({ low: 8, high: 14, confidence: "low", source: "configured" }), {
      wait: "Wait about 8–14 min",
      confidence: "Rough guide",
    });
    assert.deepEqual(boardWaitCopy(null), { wait: null, confidence: null });
    assert.equal(boardWaitCopy({ low: 4, high: 9 }, "hi").wait, "लगभग 4–9 मिनट इंतज़ार");
  });

  it("formats last-updated and pauses polling on a hidden tab", () => {
    assert.equal(boardLastUpdated(null, 1), "Not updated yet");
    assert.equal(boardLastUpdated("2026-11-21T06:00:00.000Z", Date.parse("2026-11-21T06:00:03Z")), "Updated just now");
    assert.equal(boardLastUpdated("2026-11-21T06:00:00.000Z", Date.parse("2026-11-21T06:00:20Z")), "Updated 20s ago");
    assert.equal(boardPollMs({ hidden: true }), null);
    assert.equal(boardPollMs({}), 15_000);
  });
});
