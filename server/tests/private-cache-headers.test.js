import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-not-for-production";

describe("private responses are never cached (offline-friendly client)", () => {
  const app = createApp({ clientOrigin: "http://localhost:5173", rateLimit: false });

  it("marks auth responses no-store, even errors", async () => {
    const res = await request(app).get("/api/auth/me");
    assert.equal(res.status, 401);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("marks admin responses no-store", async () => {
    const res = await request(app).get("/api/admin/ping");
    assert.equal(res.status, 401);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("leaves public endpoints alone", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.notEqual(res.headers["cache-control"], "no-store");
  });
});
