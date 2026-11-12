import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { audienceLabel, dismissKey, forQueue, toCampusInput, untilLabel, visibleNotices } from "./announcements.js";

const list = [
  { id: "a", scope: "campus", tone: "info", startsAt: "2026-11-12T03:00:00Z", updatedAt: "1" },
  { id: "b", scope: "venue", venueId: "v1", tone: "delay", startsAt: "2026-11-12T04:00:00Z", updatedAt: "1" },
  { id: "c", scope: "queue", queueId: "q1", venueId: "v1", tone: "closure", startsAt: "2026-11-12T02:00:00Z", updatedAt: "1" },
  { id: "d", scope: "queue", queueId: "q2", venueId: "v1", tone: "info", startsAt: "2026-11-12T02:00:00Z", updatedAt: "1" },
  { id: "e", scope: "venue", venueId: "v2", tone: "info", startsAt: "2026-11-12T02:00:00Z", updatedAt: "1" },
];

describe("announcements helpers", () => {
  it("keeps only notices for the queue, its venue and the campus", () => {
    assert.deepEqual(forQueue(list, "q1", "v1").map((a) => a.id).sort(), ["a", "b", "c"]);
    assert.deepEqual(forQueue(list, null, null).map((a) => a.id), ["a"]);
  });

  it("orders closures first and hides dismissed ones until edited", () => {
    const shown = visibleNotices(forQueue(list, "q1", "v1"), [dismissKey(list[0])]);
    assert.deepEqual(shown.map((a) => a.id), ["c", "b"]);
    const edited = { ...list[0], updatedAt: "2" };
    assert.equal(visibleNotices([edited], [dismissKey(list[0])]).length, 1);
  });

  it("formats end times and console inputs in campus time", () => {
    const now = Date.parse("2026-11-12T04:30:00Z");
    assert.equal(untilLabel("2026-11-12T12:30:00Z", now), "6:00 PM IST");
    assert.equal(untilLabel("2026-11-14T12:30:00Z", now), "Sat 14 Nov, 6:00 PM IST");
    assert.equal(toCampusInput("2026-11-12T18:29:00Z"), "2026-11-12T23:59");
    assert.equal(audienceLabel({ scope: "venue", venueName: "Campus Hub" }), "Everyone at Campus Hub");
    assert.equal(audienceLabel({ scope: "queue", queueName: "Gym" }), "Gym line");
  });
});
