import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { parseClientOrigins } from "../src/corsOrigin.js";

describe("parseClientOrigins", () => {
  it("defaults to Vite when empty in non-production", () => {
    assert.equal(
      parseClientOrigins("", { nodeEnv: "development" }),
      "http://localhost:5173"
    );
    assert.equal(
      parseClientOrigins(undefined, { nodeEnv: "test" }),
      "http://localhost:5173"
    );
  });

  it("fails closed (no origins) when empty in production", () => {
    assert.equal(parseClientOrigins("", { nodeEnv: "production" }), false);
    assert.equal(parseClientOrigins(undefined, { nodeEnv: "production" }), false);
  });

  it("returns a single origin string", () => {
    assert.equal(parseClientOrigins("https://app.example.com"), "https://app.example.com");
    assert.equal(parseClientOrigins("https://app.example.com/"), "https://app.example.com");
  });

  it("returns an array for comma-separated origins", () => {
    const origins = parseClientOrigins(
      "https://a.example.com, https://b.example.com/"
    );
    assert.deepEqual(origins, ["https://a.example.com", "https://b.example.com"]);
  });

  it("treats * as allow-all (cors origin: true)", () => {
    assert.equal(parseClientOrigins("*"), true);
  });
});

describe("CORS headers on /api/health", () => {
  it("reflects a configured single client origin", async () => {
    const origin = "https://queueit-fe.example.com";
    const app = createApp({ clientOrigin: origin });
    const res = await request(app)
      .get("/api/health")
      .set("Origin", origin);

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], origin);
  });

  it("allows a matching origin from a multi-origin list", async () => {
    const app = createApp({
      clientOrigin: ["https://a.example.com", "https://b.example.com"],
    });
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "https://b.example.com");

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "https://b.example.com");
  });

  it("answers preflight OPTIONS with allowed methods/headers", async () => {
    const origin = "https://queueit-fe.example.com";
    const app = createApp({ clientOrigin: origin });
    const res = await request(app)
      .options("/api/auth/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,authorization");

    assert.ok(res.status === 204 || res.status === 200);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    const methods = (res.headers["access-control-allow-methods"] || "").toUpperCase();
    assert.ok(methods.includes("POST"));
  });
});
