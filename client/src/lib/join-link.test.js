/**
 * Run: node --test client/src/lib/join-link.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isQueueId,
  isSafeAppPath,
  joinPath,
  joinUrl,
  parseJoinTarget,
  posterPayload,
  posterQrValue,
  POSTER_PAYLOAD_PREFIX,
} from "./join-link.js";

const ID = "64b0c0ffee00000000000001";

describe("isQueueId", () => {
  it("accepts 24-char hex ids", () => {
    assert.equal(isQueueId(ID), true);
    assert.equal(isQueueId(ID.toUpperCase()), true);
  });

  it("rejects anything else", () => {
    assert.equal(isQueueId("cafeteria"), false);
    assert.equal(isQueueId("64b0c0ffee0000000000000"), false);
    assert.equal(isQueueId(""), false);
    assert.equal(isQueueId(null), false);
  });
});

describe("joinPath / joinUrl / poster payload", () => {
  it("builds a /join/:id path and absolute URL", () => {
    assert.equal(joinPath(ID), `/join/${ID}`);
    assert.equal(joinUrl("https://queueit.example", ID), `https://queueit.example/join/${ID}`);
    assert.equal(joinUrl("http://localhost:5173/", ID), `http://localhost:5173/join/${ID}`);
  });

  it("rejects a bad origin or id", () => {
    assert.equal(joinUrl("not-a-url", ID), null);
    assert.equal(joinUrl("https://queueit.example", "nope"), null);
    assert.equal(joinPath("nope"), null);
  });

  it("encodes the absolute URL in the poster QR, not an arrival pass", () => {
    const value = posterQrValue("https://queueit.example", ID);
    assert.equal(value, `https://queueit.example/join/${ID}`);
    assert.equal(value.startsWith("QIT:"), false);
    assert.equal(posterPayload(ID), `${POSTER_PAYLOAD_PREFIX}${ID}`);
  });
});

describe("parseJoinTarget", () => {
  it("parses absolute URLs, paths, ?join=, and QITJ: payloads", () => {
    assert.equal(parseJoinTarget(`https://queueit.example/join/${ID}`), ID);
    assert.equal(parseJoinTarget(`https://queueit.example/join/${ID}/?x=1`), ID);
    assert.equal(parseJoinTarget(`/join/${ID}`), ID);
    assert.equal(parseJoinTarget(`https://queueit.example/queues?join=${ID}`), ID);
    assert.equal(parseJoinTarget(`/queues?join=${ID}`), ID);
    assert.equal(parseJoinTarget(`${POSTER_PAYLOAD_PREFIX}${ID}`), ID);
  });

  it("never treats an arrival pass as a join link", () => {
    assert.equal(parseJoinTarget(`QIT:${ID}:12:deadbeef`), null);
  });

  it("returns null for junk", () => {
    assert.equal(parseJoinTarget(""), null);
    assert.equal(parseJoinTarget("https://evil.example/join/not-an-id"), null);
    assert.equal(parseJoinTarget("QITJ:nope"), null);
    assert.equal(parseJoinTarget(null), null);
  });
});

describe("isSafeAppPath", () => {
  it("allows in-app paths only", () => {
    assert.equal(isSafeAppPath(`/join/${ID}`), true);
    assert.equal(isSafeAppPath("/queues"), true);
    assert.equal(isSafeAppPath("https://evil.example/"), false);
    assert.equal(isSafeAppPath("//evil.example"), false);
    assert.equal(isSafeAppPath("/\\evil"), false);
    assert.equal(isSafeAppPath("queues"), false);
  });
});
