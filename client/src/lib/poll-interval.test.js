import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveStatusPollMs,
  STATUS_POLL_VISIBLE_MS,
  STATUS_POLL_SOCKET_MS,
} from "./poll-interval.js";

describe("resolveStatusPollMs", () => {
  it("uses 3s when the tab is visible and there is no socket", () => {
    assert.equal(resolveStatusPollMs({ hidden: false, realtimeConnected: false }), STATUS_POLL_VISIBLE_MS);
  });

  it("slows to 15s when a socket is connected and the tab is visible", () => {
    assert.equal(resolveStatusPollMs({ hidden: false, realtimeConnected: true }), STATUS_POLL_SOCKET_MS);
  });

  it("pauses entirely while the tab is hidden", () => {
    assert.equal(resolveStatusPollMs({ hidden: true, realtimeConnected: false }), null);
    assert.equal(resolveStatusPollMs({ hidden: true, realtimeConnected: true }), null);
  });
});
