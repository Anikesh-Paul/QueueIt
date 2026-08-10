/**
 * Pure helpers for admin QR scan — no real camera.
 * Run: node --test client/src/lib/qr-scanner.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCAN_COPY,
  getCameraAvailability,
  isCameraEnvironmentOk,
  canUseNativeQrDetector,
  mapCameraError,
} from "./qr-scanner.js";

describe("SCAN_COPY (locked ticket 10 strings)", () => {
  it("exposes denied / no camera / insecure copy", () => {
    assert.equal(SCAN_COPY.denied, "Camera blocked — type the pass.");
    assert.equal(SCAN_COPY.noCamera, "No camera — type the pass.");
    assert.equal(SCAN_COPY.insecure, "Camera needs HTTPS.");
  });
});

describe("getCameraAvailability / isCameraEnvironmentOk", () => {
  it("reports no-camera (not insecure) when mediaDevices is missing on secure context", () => {
    const a = getCameraAvailability({
      isSecureContext: true,
      navigator: {},
    });
    assert.equal(a.ok, false);
    assert.equal(a.kind, "noCamera");
    assert.equal(a.message, SCAN_COPY.noCamera);
    assert.equal(isCameraEnvironmentOk({ isSecureContext: true, navigator: {} }), false);
  });

  it("reports insecure when origin is not secure even with getUserMedia", () => {
    const a = getCameraAvailability({
      isSecureContext: false,
      location: { protocol: "http:", hostname: "example.com" },
      navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
    });
    assert.equal(a.ok, false);
    assert.equal(a.kind, "insecure");
    assert.equal(a.message, SCAN_COPY.insecure);
  });

  it("is ok on secure context with getUserMedia", () => {
    const a = getCameraAvailability({
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
    });
    assert.equal(a.ok, true);
    assert.equal(
      isCameraEnvironmentOk({
        isSecureContext: true,
        navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
      }),
      true
    );
  });

  it("treats localhost as secure when isSecureContext is missing", () => {
    const a = getCameraAvailability({
      location: { protocol: "http:", hostname: "localhost" },
      navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
    });
    assert.equal(a.ok, true);
  });
});

describe("canUseNativeQrDetector", () => {
  it("is false when BarcodeDetector is missing", async () => {
    assert.equal(await canUseNativeQrDetector(undefined), false);
  });

  it("is false when qr_code is not in supported formats", async () => {
    function Fake() {}
    Fake.getSupportedFormats = async () => ["code_128"];
    assert.equal(await canUseNativeQrDetector(Fake), false);
  });

  it("is true when qr_code is supported", async () => {
    function Fake() {}
    Fake.getSupportedFormats = async () => ["qr_code", "code_128"];
    assert.equal(await canUseNativeQrDetector(Fake), true);
  });

  it("is false when getSupportedFormats is missing (Windows Chrome trap)", async () => {
    function Fake() {}
    assert.equal(await canUseNativeQrDetector(Fake), false);
  });
});

describe("mapCameraError", () => {
  it("maps NotAllowedError to denied copy", () => {
    const err = new Error("x");
    err.name = "NotAllowedError";
    assert.deepEqual(mapCameraError(err), {
      message: SCAN_COPY.denied,
      kind: "denied",
    });
  });

  it("maps NotFoundError to no-camera copy", () => {
    const err = new Error("x");
    err.name = "NotFoundError";
    assert.deepEqual(mapCameraError(err), {
      message: SCAN_COPY.noCamera,
      kind: "noCamera",
    });
  });

  it("maps unknown to unavailable", () => {
    assert.equal(mapCameraError(new Error("boom")).kind, "unavailable");
  });

  it("maps SecurityError to insecure on non-secure origin", () => {
    const err = new Error("x");
    err.name = "SecurityError";
    assert.deepEqual(
      mapCameraError(err, { isSecureContext: false, location: { protocol: "http:", hostname: "x.com" } }),
      { message: SCAN_COPY.insecure, kind: "insecure" }
    );
  });

  it("maps SecurityError to denied on secure origin", () => {
    const err = new Error("x");
    err.name = "SecurityError";
    assert.deepEqual(mapCameraError(err, { isSecureContext: true }), {
      message: SCAN_COPY.denied,
      kind: "denied",
    });
  });
});
