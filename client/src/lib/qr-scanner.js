/**
 * Admin Check arrival — progressive QR scan (phone-first).
 *
 * Stack (locked plan §4 / research 01):
 *   1. Platform BarcodeDetector when qr_code is supported
 *   2. Else lazy @zxing/browser BrowserQRCodeReader (QR-only)
 *
 * Decoded string feeds the existing verify-qr path — no second protocol.
 * Manual Pass or token + Verify stays first-class; this module only owns camera.
 *
 * Test seam: pass deps, or set globalThis.__QUEUEIT_QR_SCANNER__ = { start } to
 * mock the whole camera path (Playwright / headless CI).
 */

/** Locked scan-specific strings (ticket 10). */
export const SCAN_COPY = Object.freeze({
  denied: "Camera blocked — type the pass.",
  noCamera: "No camera — type the pass.",
  insecure: "Camera needs HTTPS.",
  unavailable: "Camera unavailable.",
});

/**
 * Whether the page is a secure context (or localhost equivalent).
 * @param {Window | typeof globalThis} [env]
 */
export function isSecureCameraContext(env = globalThis) {
  try {
    if (typeof env.isSecureContext === "boolean") return env.isSecureContext;
    return (
      env.location?.protocol === "https:" ||
      env.location?.hostname === "localhost" ||
      env.location?.hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

/**
 * Preflight camera environment → ok or locked failure (ticket 10 strings).
 * Distinguishes insecure origin from missing getUserMedia / no-camera API.
 * @param {Window | typeof globalThis} [env]
 * @returns {{ ok: true } | { ok: false, kind: "insecure" | "noCamera", message: string }}
 */
export function getCameraAvailability(env = globalThis) {
  try {
    if (!isSecureCameraContext(env)) {
      return { ok: false, kind: "insecure", message: SCAN_COPY.insecure };
    }
    const media = env.navigator?.mediaDevices?.getUserMedia;
    if (typeof media !== "function") {
      return { ok: false, kind: "noCamera", message: SCAN_COPY.noCamera };
    }
    return { ok: true };
  } catch {
    return { ok: false, kind: "noCamera", message: SCAN_COPY.noCamera };
  }
}

/**
 * Secure context + getUserMedia available (camera environment OK).
 * @param {Window | typeof globalThis} [env]
 */
export function isCameraEnvironmentOk(env = globalThis) {
  return getCameraAvailability(env).ok;
}

/**
 * True when platform BarcodeDetector can actually decode QR (not just constructor present).
 * @param {typeof BarcodeDetector | undefined} [BarcodeDetectorImpl]
 */
export async function canUseNativeQrDetector(
  BarcodeDetectorImpl = globalThis.BarcodeDetector
) {
  if (typeof BarcodeDetectorImpl !== "function") return false;
  try {
    if (typeof BarcodeDetectorImpl.getSupportedFormats === "function") {
      const formats = await BarcodeDetectorImpl.getSupportedFormats();
      return Array.isArray(formats) && formats.includes("qr_code");
    }
    // Constructor exists without getSupportedFormats — try create; still may be a no-op OS.
    // Prefer formats check when available; without it treat as unsupported (Windows Chrome trap).
    return false;
  } catch {
    return false;
  }
}

/**
 * Map getUserMedia / media errors to locked copy (ticket 10).
 * @param {unknown} err
 * @param {Window | typeof globalThis} [env] used to reclassify SecurityError on insecure origin
 * @returns {{ message: string, kind: "denied" | "noCamera" | "insecure" | "unavailable" }}
 */
export function mapCameraError(err, env = globalThis) {
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  if (name === "NotAllowedError") {
    return { message: SCAN_COPY.denied, kind: "denied" };
  }
  // SecurityError is often insecure-context; otherwise treat as blocked permission.
  if (name === "SecurityError") {
    if (!isSecureCameraContext(env)) {
      return { message: SCAN_COPY.insecure, kind: "insecure" };
    }
    return { message: SCAN_COPY.denied, kind: "denied" };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return { message: SCAN_COPY.noCamera, kind: "noCamera" };
  }
  if (name === "NotSupportedError") {
    return { message: SCAN_COPY.insecure, kind: "insecure" };
  }
  // Hardware busy / Abort / unknown — research fallback (not a ticket-10 disable string).
  return { message: SCAN_COPY.unavailable, kind: "unavailable" };
}

/**
 * Open rear-preferring camera stream; fall back to any video if overconstrained.
 * @param {{ getUserMedia?: MediaDevices["getUserMedia"] }} [deps]
 * @returns {Promise<MediaStream>}
 */
export async function openCameraStream(deps = {}) {
  const getUserMedia =
    deps.getUserMedia ||
    globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices);

  if (typeof getUserMedia !== "function") {
    const err = new Error(SCAN_COPY.insecure);
    err.name = "NotSupportedError";
    throw err;
  }

  try {
    return await getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
  } catch (err) {
    if (err && typeof err === "object" && err.name === "OverconstrainedError") {
      return getUserMedia({ audio: false, video: true });
    }
    throw err;
  }
}

function stopStreamTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Native BarcodeDetector continuous loop until first QR or stop().
 * @returns {{ stop: () => void }}
 */
function startNativeDetectLoop(videoEl, detector, onDecode) {
  let active = true;
  let raf = 0;

  const tick = async () => {
    if (!active) return;
    try {
      if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await detector.detect(videoEl);
        if (!active) return;
        const raw = codes?.[0]?.rawValue;
        if (typeof raw === "string" && raw.trim()) {
          active = false;
          onDecode(raw.trim());
          return;
        }
      }
    } catch {
      // transient detect errors — keep hunting
    }
    if (active) raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  return {
    stop() {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * Lazy ZXing QR-only continuous decode from an existing MediaStream.
 * @returns {Promise<{ stop: () => void }>}
 */
async function startZxingFromStream(videoEl, stream, onDecode, loadZxing) {
  const mod = await loadZxing();
  const BrowserQRCodeReader = mod.BrowserQRCodeReader;
  if (typeof BrowserQRCodeReader !== "function") {
    throw new Error("ZXing BrowserQRCodeReader unavailable");
  }
  const reader = new BrowserQRCodeReader();
  let settled = false;

  const controls = await reader.decodeFromStream(stream, videoEl, (result, _error, ctrl) => {
    if (settled) return;
    if (result) {
      const text =
        typeof result.getText === "function" ? result.getText() : String(result.text || "");
      const raw = text.trim();
      if (!raw) return;
      settled = true;
      try {
        ctrl?.stop?.();
      } catch {
        /* ignore */
      }
      onDecode(raw);
    }
    // NotFoundException while hunting is normal — ignore
  });

  return {
    stop() {
      settled = true;
      try {
        controls?.stop?.();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Start progressive QR scan into `videoEl`.
 * First good decode → onDecode once; caller should stop session and auto-verify.
 *
 * @param {object} options
 * @param {HTMLVideoElement} options.videoEl
 * @param {(rawValue: string) => void} options.onDecode
 * @param {(info: { message: string, kind: string }) => void} [options.onError]
 * @param {object} [options.deps] injectable seams for tests / mock
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startQrScan({ videoEl, onDecode, onError, deps = {} }) {
  const mock = globalThis.__QUEUEIT_QR_SCANNER__;
  if (mock && typeof mock.start === "function") {
    return mock.start({ videoEl, onDecode, onError, deps });
  }

  const env = deps.env || globalThis;
  const availability = getCameraAvailability(env);
  if (!availability.ok) {
    onError?.({ message: availability.message, kind: availability.kind });
    return { stop() {} };
  }

  let stream = null;
  let decoder = { stop() {} };
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      decoder.stop();
    } catch {
      /* ignore */
    }
    stopStreamTracks(stream);
    stream = null;
    if (videoEl) {
      try {
        videoEl.srcObject = null;
      } catch {
        /* ignore */
      }
    }
  };

  try {
    stream = await openCameraStream({
      getUserMedia: deps.getUserMedia,
    });
    if (stopped) {
      stopStreamTracks(stream);
      return { stop };
    }

    videoEl.srcObject = stream;
    videoEl.setAttribute("playsinline", "true");
    videoEl.muted = true;
    try {
      await videoEl.play();
    } catch {
      // autoplay policies rarely block muted inline; continue anyway
    }

    const loadZxing =
      deps.loadZxing || (() => import("@zxing/browser"));

    const BarcodeDetectorImpl =
      deps.BarcodeDetector !== undefined
        ? deps.BarcodeDetector
        : globalThis.BarcodeDetector;

    const useNative = await canUseNativeQrDetector(BarcodeDetectorImpl);

    let delivered = false;
    const deliver = (raw) => {
      if (delivered || stopped) return;
      delivered = true;
      onDecode(raw);
    };

    if (useNative) {
      const detector = new BarcodeDetectorImpl({ formats: ["qr_code"] });
      decoder = startNativeDetectLoop(videoEl, detector, deliver);
    } else {
      decoder = await startZxingFromStream(videoEl, stream, deliver, loadZxing);
    }

    return { stop };
  } catch (err) {
    stop();
    const info = mapCameraError(err, env);
    onError?.(info);
    return { stop() {} };
  }
}
