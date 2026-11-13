import test from "node:test";
import assert from "node:assert/strict";
import { appOptionsFromEnv } from "../src/bootstrap.js";

test("auth rate limit uses the default unless AUTH_RATE_LIMIT_MAX is a positive integer", () => {
  assert.deepEqual(appOptionsFromEnv({}), {});
  assert.deepEqual(appOptionsFromEnv({ AUTH_RATE_LIMIT_MAX: "" }), {});
  assert.deepEqual(appOptionsFromEnv({ AUTH_RATE_LIMIT_MAX: "0" }), {});
  assert.deepEqual(appOptionsFromEnv({ AUTH_RATE_LIMIT_MAX: "abc" }), {});
  assert.deepEqual(appOptionsFromEnv({ AUTH_RATE_LIMIT_MAX: "200" }), { authRateLimit: { max: 200 } });
});
