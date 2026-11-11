import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  parseArrivalValue,
  signArrivalPass,
  arrivalVerifyDecision,
  unsignedArrivalAllowed,
  UNSIGNED_ARRIVAL_REASON,
  ARRIVAL_MAC_LENGTH,
} from "../src/services/arrivalPass.js";

const QUEUE_ID = "5f0c1234567890abcdef1234";

describe("arrival pass parse + sign", () => {
  before(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-not-for-production";
    delete process.env.ARRIVAL_PASS_SECRET;
  });

  it("parses a bare token number for manual counter entry", () => {
    assert.deepEqual(parseArrivalValue("7"), { tokenNumber: 7, signed: false });
    assert.equal(parseArrivalValue("0x10"), null);
    assert.equal(parseArrivalValue("1e3"), null);
  });

  it("parses a legacy unsigned pass", () => {
    const parsed = parseArrivalValue(`QIT:${QUEUE_ID}:7`);
    assert.deepEqual(parsed, { queueId: QUEUE_ID, tokenNumber: 7, signed: false });
  });

  it("issues a signed pass that parses back with signed: true", () => {
    const pass = signArrivalPass(QUEUE_ID, 7);
    assert.match(pass, new RegExp(`^QIT:${QUEUE_ID}:7:[0-9a-f]{${ARRIVAL_MAC_LENGTH}}$`));
    assert.deepEqual(parseArrivalValue(pass), {
      queueId: QUEUE_ID,
      tokenNumber: 7,
      signed: true,
    });
  });

  it("rejects unsigned and bare values unless ALLOW_UNSIGNED_ARRIVAL is on", () => {
    const bare = parseArrivalValue("7");
    const unsigned = parseArrivalValue(`QIT:${QUEUE_ID}:7`);
    const signed = parseArrivalValue(signArrivalPass(QUEUE_ID, 7));
    assert.equal(arrivalVerifyDecision(bare).ok, false);
    assert.equal(arrivalVerifyDecision(bare).reason, UNSIGNED_ARRIVAL_REASON);
    assert.equal(arrivalVerifyDecision(unsigned).ok, false);
    assert.equal(arrivalVerifyDecision(signed).ok, true);
    assert.equal(arrivalVerifyDecision(bare, { allowUnsigned: true }).ok, true);
    assert.equal(unsignedArrivalAllowed({}), false);
    assert.equal(unsignedArrivalAllowed({ ALLOW_UNSIGNED_ARRIVAL: "1" }), true);
    assert.equal(unsignedArrivalAllowed({ ALLOW_UNSIGNED_ARRIVAL: "true" }), true);
  });

  it("rejects a tampered MAC and a pass signed with the wrong secret", () => {
    const pass = signArrivalPass(QUEUE_ID, 7);
    const tampered = pass.slice(0, -1) + (pass.endsWith("a") ? "b" : "a");
    assert.deepEqual(parseArrivalValue(tampered), { invalidSignature: true });

    process.env.ARRIVAL_PASS_SECRET = "other-arrival-secret";
    try {
      assert.deepEqual(parseArrivalValue(pass), { invalidSignature: true });
    } finally {
      delete process.env.ARRIVAL_PASS_SECRET;
    }
  });
});
