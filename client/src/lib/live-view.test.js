import test from "node:test";
import assert from "node:assert/strict";
import {
  counterStateLabel,
  focusedQueue,
  formatAgo,
  formatCampusClock,
  formatWait,
  isStale,
  liveParamsToSearch,
  livePollMs,
  nextRotationIndex,
  parseLiveParams,
  rotationQueues,
  throughputPercent,
} from "./live-view.js";

const ID = "0123456789abcdef01234567";

test("URL settings round-trip and reject junk", () => {
  assert.deepEqual(parseLiveParams(""), { queueId: null, rotateSeconds: 0, highContrast: false, tv: false });
  const parsed = parseLiveParams(`?queue=${ID}&rotate=20&contrast=high&tv=1`);
  assert.deepEqual(parsed, { queueId: ID, rotateSeconds: 20, highContrast: true, tv: true });
  assert.equal(liveParamsToSearch(parsed), `?queue=${ID}&rotate=20&contrast=high&tv=1`);
  assert.deepEqual(parseLiveParams("?queue=<script>&rotate=7&contrast=yes&tv=true"), {
    queueId: null,
    rotateSeconds: 0,
    highContrast: false,
    tv: false,
  });
  assert.equal(liveParamsToSearch({}), "");
});

test("polling pauses when hidden and backs off on failures", () => {
  assert.equal(livePollMs({ hidden: true }), null);
  assert.equal(livePollMs({}), 15_000);
  assert.equal(livePollMs({ refreshSeconds: 1 }), 5_000);
  assert.equal(livePollMs({ failures: 1 }), 30_000);
  assert.equal(livePollMs({ failures: 5 }), 60_000);
});

test("staleness and last-updated text", () => {
  assert.equal(isStale(null, 1000), false);
  assert.equal(isStale(0 + 1, 44_000), false);
  assert.equal(isStale(1, 46_002), true);
  assert.equal(formatAgo(null, 1), "Not updated yet");
  assert.equal(formatAgo(1000, 3000), "Updated just now");
  assert.equal(formatAgo(1000, 21_000), "Updated 20s ago");
  assert.equal(formatAgo(1000, 181_000), "Updated 3 min ago");
});

test("wait, counter state and bar labels", () => {
  assert.equal(formatWait(null), "—");
  assert.equal(formatWait(0.4), "<1 min");
  assert.equal(formatWait(12.6), "13 min");
  assert.equal(formatWait(65), "1 h 5 min");
  assert.equal(formatWait(120), "2 h");
  assert.equal(counterStateLabel("open"), "Open");
  assert.equal(counterStateLabel("break"), "On break");
  assert.equal(counterStateLabel("closed"), "Closed");
  assert.equal(throughputPercent(0, 10), 0);
  assert.equal(throughputPercent(1, 100), 4);
  assert.equal(throughputPercent(5, 10), 50);
});

test("rotation cycles queues unless a queue is pinned", () => {
  const queues = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(rotationQueues(queues, { rotateSeconds: 0 }), []);
  assert.deepEqual(rotationQueues([{ id: "a" }], { rotateSeconds: 10 }), []);
  assert.equal(rotationQueues(queues, { rotateSeconds: 10 }).length, 3);
  assert.equal(nextRotationIndex(2, 3), 0);
  assert.equal(nextRotationIndex(0, 0), 0);
  assert.equal(focusedQueue(queues, { rotateSeconds: 0 }), null);
  assert.equal(focusedQueue(queues, { rotateSeconds: 10, rotationIndex: 4 }).id, "b");
  assert.equal(focusedQueue(queues, { queueId: "c", rotateSeconds: 10 }).id, "c");
  assert.equal(focusedQueue(queues, { queueId: "zzz" }), null);
});

test("campus clock is IST", () => {
  assert.equal(formatCampusClock(new Date("2026-11-14T09:35:00Z")), "3:05 PM");
});
