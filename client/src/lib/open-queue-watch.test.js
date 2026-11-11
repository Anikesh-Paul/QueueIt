import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseOpenWatches,
  subscribeOpenWatch,
  cancelOpenWatch,
  isWatchingOpen,
  decideOpenNotification,
  openNotificationCopy,
} from "./open-queue-watch.js";

describe("open-queue watch signup and cancel", () => {
  it("subscribes once and can cancel", () => {
    const first = subscribeOpenWatch([], "q1");
    assert.deepEqual(first, ["q1"]);
    const again = subscribeOpenWatch(first, "q1");
    assert.deepEqual(again, ["q1"]);
    const two = subscribeOpenWatch(first, "q2");
    assert.deepEqual(two, ["q1", "q2"]);
    assert.equal(isWatchingOpen(two, "q1"), true);
    assert.deepEqual(cancelOpenWatch(two, "q1"), ["q2"]);
    assert.deepEqual(cancelOpenWatch(["q2"], "q2"), []);
    assert.deepEqual(cancelOpenWatch(["q2"], "missing"), ["q2"]);
  });

  it("ignores blank or duplicate ids when parsing", () => {
    assert.deepEqual(parseOpenWatches('["q1","","q1","q2"]'), ["q1", "q2"]);
    assert.deepEqual(parseOpenWatches("not-json"), []);
    assert.deepEqual(subscribeOpenWatch([], "  "), []);
  });
});

describe("decideOpenNotification", () => {
  it("fires when a watched closed queue starts accepting, then cancels", () => {
    const closed = decideOpenNotification({
      watching: true,
      previousAccepting: false,
      acceptingTokens: false,
    });
    assert.deepEqual(closed, { fire: false, watching: true, previousAccepting: false });

    const opened = decideOpenNotification({
      watching: true,
      previousAccepting: false,
      acceptingTokens: true,
    });
    assert.equal(opened.fire, true);
    assert.equal(opened.watching, false);

    const again = decideOpenNotification({
      watching: false,
      previousAccepting: true,
      acceptingTokens: true,
    });
    assert.equal(again.fire, false);
  });

  it("does not fire while the queue stays closed (scheduled or stop-accepting)", () => {
    const stillClosed = decideOpenNotification({
      watching: true,
      previousAccepting: null,
      acceptingTokens: false,
    });
    assert.equal(stillClosed.fire, false);
    assert.equal(stillClosed.watching, true);
    assert.equal(stillClosed.previousAccepting, false);
  });

  it("fires once if the tab reloads after the queue has already opened", () => {
    const missed = decideOpenNotification({
      watching: true,
      previousAccepting: null,
      acceptingTokens: true,
    });
    assert.equal(missed.fire, true);
    assert.equal(missed.watching, false);
  });

  it("does not fire for a paused-but-accepting queue that was never watched as closed", () => {
    const decision = decideOpenNotification({
      watching: false,
      previousAccepting: true,
      acceptingTokens: true,
    });
    assert.equal(decision.fire, false);
    assert.equal(decision.watching, false);
  });
});

describe("openNotificationCopy", () => {
  it("tells the student they can join now", () => {
    assert.deepEqual(openNotificationCopy({ queueName: "Cafeteria" }), {
      title: "Cafeteria is accepting tokens",
      body: "You can join Cafeteria now.",
    });
  });
});
