import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatStatusAge, statusConnectionPresentation } from "./status-connection.js";

describe("formatStatusAge", () => {
  it("says just now when a live snapshot is under 5 seconds old", () => {
    assert.equal(formatStatusAge(1_000, 3_000), "just now");
  });

  it("does not say just now when offline, even if the snapshot is fresh", () => {
    assert.equal(formatStatusAge(1_000, 3_000, { offline: true }), "last known");
  });

  it("keeps a relative age once more than 5 seconds have passed", () => {
    assert.equal(formatStatusAge(1_000, 13_000), "12s ago");
    assert.equal(formatStatusAge(1_000, 13_000, { offline: true }), "12s ago");
  });
});

describe("statusConnectionPresentation", () => {
  it("never claims Instant, Live, realtime, or just now while offline", () => {
    const view = statusConnectionPresentation({
      offline: true,
      realtimeConnected: true,
      statusLastUpdatedAt: 1_000,
      nowMs: 2_000,
    });
    assert.equal(view.metaLabel, "Offline — last known place");
    assert.equal(view.indicator, "offline");
    assert.equal(view.ageLabel, "last known");
    assert.equal(view.showLiveBadge, false);
    const blob = `${view.metaLabel} ${view.indicator} ${view.ageLabel}`;
    assert.equal(/instant|realtime|just now|\blive\b/i.test(blob), false);
  });

  it("shows Instant updates and a live badge when the socket is connected", () => {
    const view = statusConnectionPresentation({
      offline: false,
      realtimeConnected: true,
      statusLastUpdatedAt: 1_000,
      nowMs: 2_000,
    });
    assert.equal(view.metaLabel, "Instant updates");
    assert.equal(view.indicator, "realtime");
    assert.equal(view.ageLabel, "just now");
    assert.equal(view.showLiveBadge, true);
  });

  it("shows polling copy when online without a socket", () => {
    const view = statusConnectionPresentation({
      offline: false,
      realtimeConnected: false,
    });
    assert.equal(view.metaLabel, "Updates every few seconds");
    assert.equal(view.indicator, "polling");
    assert.equal(view.showLiveBadge, true);
  });
});
