import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEAR_FRONT_POSITION_LIMIT,
  resolveQueueAlert,
  decideNotification,
  notificationCopy,
  alertKey,
} from "./queue-notifications.js";

describe("resolveQueueAlert", () => {
  it("returns near for positions 2 and 3, next for 1", () => {
    assert.equal(NEAR_FRONT_POSITION_LIMIT, 3);
    assert.equal(resolveQueueAlert({ paused: false, position: 3 }), "near");
    assert.equal(resolveQueueAlert({ paused: false, position: 2 }), "near");
    assert.equal(resolveQueueAlert({ paused: false, position: 1 }), "next");
    assert.equal(resolveQueueAlert({ paused: false, position: 4 }), null);
  });

  it("returns serving when nowServing equals the student's token or status is serving", () => {
    assert.equal(
      resolveQueueAlert({ paused: false, position: 1, tokenNumber: 7, nowServing: 7 }),
      "serving"
    );
    assert.equal(resolveQueueAlert({ paused: false, position: 0, status: "serving" }), "serving");
  });

  it("does not nudge approach while the queue is paused", () => {
    assert.equal(resolveQueueAlert({ paused: true, position: 1, tokenNumber: 7, nowServing: 7 }), null);
    assert.equal(resolveQueueAlert({ paused: true, position: 2 }), null);
  });
});

describe("decideNotification", () => {
  const base = { queueId: "q1", tokenNumber: 12, position: 3, paused: false };

  it("fires once when the student first enters the near-front band", () => {
    const first = decideNotification({ ...base, lastKey: null });
    assert.equal(first.fire, true);
    assert.equal(first.kind, "near");
    const again = decideNotification({ ...base, lastKey: first.lastKey });
    assert.equal(again.fire, false);
    assert.equal(again.lastKey, first.lastKey);
  });

  it("fires again on escalation from near to next", () => {
    const near = decideNotification({ ...base, position: 3, lastKey: null });
    const next = decideNotification({ ...base, position: 1, lastKey: near.lastKey });
    assert.equal(next.fire, true);
    assert.equal(next.kind, "next");
  });

  it("does not fire while paused, and can fire once after resume", () => {
    const paused = decideNotification({ ...base, position: 1, paused: true, lastKey: "q1:12:next" });
    assert.equal(paused.fire, false);
    assert.equal(paused.lastKey, null);
    const resumed = decideNotification({ ...base, position: 1, paused: false, lastKey: paused.lastKey });
    assert.equal(resumed.fire, true);
    assert.equal(resumed.kind, "next");
  });

  it("fires serving when the token is now serving", () => {
    const decision = decideNotification({
      ...base,
      position: 1,
      nowServing: 12,
      lastKey: alertKey("q1", 12, "next"),
    });
    assert.equal(decision.fire, true);
    assert.equal(decision.kind, "serving");
  });
});

describe("notificationCopy", () => {
  it("matches the in-page banner for next and near", () => {
    assert.deepEqual(notificationCopy({ kind: "next", queueName: "Cafeteria" }), {
      title: "You're next · Cafeteria",
      body: "Approach the counter.",
    });
    assert.deepEqual(notificationCopy({ kind: "near", position: 3, queueName: "Cafeteria" }), {
      title: "Near the front · Cafeteria",
      body: "2 ahead — approach soon.",
    });
  });
});
