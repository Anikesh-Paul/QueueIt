import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("returns 200 with ok status", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.service, "queueit-server");
  });
});
