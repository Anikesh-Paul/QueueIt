import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { verifyArrival } from "@/api";
import { getCameraAvailability, SCAN_COPY, startQrScan } from "@/lib/qr-scanner";

/**
 * Scan pass (camera) primary; Pass or token + Verify always first-class.
 * Serve stays on the list (verify-only — no serve-from-scan / F8).
 */
export function AdminCheckArrival({ token, queueId, setSelectedEntryId }) {
  const [verifyValue, setVerifyValue] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  /** @type {{ verified: boolean, entry?: object, reason?: string } | null} */
  const [verifyResult, setVerifyResult] = useState(null);
  /** System/network failures are errors — never a counter "No match". */
  const [verifyError, setVerifyError] = useState("");

  /** Camera scan panel open (inline video + Stop). */
  const [scanActive, setScanActive] = useState(false);
  /** Permanent disable after permission / no-camera / insecure (ticket 10). */
  const [scanDisabled, setScanDisabled] = useState(
    () => !getCameraAvailability().ok
  );
  const [scanMessage, setScanMessage] = useState(() => {
    const a = getCameraAvailability();
    return a.ok ? "" : a.message;
  });
  const videoRef = useRef(null);
  const scanSessionRef = useRef(null);
  /** Avoid double auto-verify if decode races stop. */
  const scanDecodeLockRef = useRef(false);
  const verifyBusyRef = useRef(false);
  /** Latest auth/queue for scan callbacks (avoid stale closures). */
  const verifyCtxRef = useRef({ token, queueId, setSelectedEntryId });
  verifyCtxRef.current = { token, queueId, setSelectedEntryId };

  useEffect(() => {
    setVerifyValue("");
    setVerifyResult(null);
    setVerifyError("");
    {
      const a = getCameraAvailability();
      setScanMessage(a.ok ? "" : a.message);
      setScanDisabled(!a.ok);
    }
    // Leaving a queue must not leave the camera running.
    try {
      scanSessionRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    scanSessionRef.current = null;
    setScanActive(false);
    scanDecodeLockRef.current = false;
  }, [queueId]);

  useEffect(() => {
    return () => {
      try {
        scanSessionRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      scanSessionRef.current = null;
    };
  }, []);

  /**
   * When Scan opens the inline panel, bind camera after <video> mounts.
   * First good decode → stop → fill field → auto-verify; no auto re-arm.
   */
  useEffect(() => {
    if (!scanActive) return undefined;

    let cancelled = false;

    (async () => {
      const videoEl = videoRef.current;
      if (!videoEl) {
        if (!cancelled) {
          setScanActive(false);
          setScanDisabled(true);
          setScanMessage(SCAN_COPY.unavailable);
          focusVerifyField();
        }
        return;
      }

      const session = await startQrScan({
        videoEl,
        onDecode: (raw) => {
          if (cancelled || scanDecodeLockRef.current) return;
          scanDecodeLockRef.current = true;
          try {
            scanSessionRef.current?.stop?.();
          } catch {
            /* ignore */
          }
          scanSessionRef.current = null;
          setScanActive(false);
          const value = String(raw ?? "").trim();
          setVerifyValue(value);
          void runVerify(value);
        },
        onError: ({ message, kind }) => {
          if (cancelled) return;
          scanSessionRef.current = null;
          setScanActive(false);
          if (kind === "denied" || kind === "noCamera" || kind === "insecure") {
            setScanDisabled(true);
          }
          setScanMessage(message);
          focusVerifyField();
        },
      });

      if (cancelled || scanDecodeLockRef.current) {
        try {
          session?.stop?.();
        } catch {
          /* ignore */
        }
        return;
      }
      scanSessionRef.current = session;
    })();

    return () => {
      cancelled = true;
      try {
        scanSessionRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      scanSessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start only when panel opens
  }, [scanActive]);

  function focusVerifyField() {
    requestAnimationFrame(() => {
      document.getElementById("verify-value")?.focus?.();
    });
  }

  function stopScanSession() {
    try {
      scanSessionRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    scanSessionRef.current = null;
    setScanActive(false);
    scanDecodeLockRef.current = false;
  }

  /**
   * Shared verify path for manual submit and post-scan auto-verify.
   * Does not serve (F8 out) — only selects the wait row on success.
   */
  async function runVerify(rawValue) {
    const value = String(rawValue ?? "").trim();
    if (!value || verifyBusyRef.current) return;
    const { token: authToken, queueId: qid, setSelectedEntryId: select } =
      verifyCtxRef.current;
    verifyBusyRef.current = true;
    setVerifyBusy(true);
    setVerifyResult(null);
    setVerifyError("");
    try {
      const data = await verifyArrival(authToken, qid, value);
      setVerifyResult(data);
      if (data?.verified && data.entry?.id) {
        select(data.entry.id);
      }
    } catch (err) {
      setVerifyError(err.message || "Could not check arrival");
    } finally {
      verifyBusyRef.current = false;
      setVerifyBusy(false);
    }
  }

  async function handleVerify(event) {
    event.preventDefault();
    await runVerify(verifyValue);
  }

  function handleScanPass() {
    if (scanDisabled || scanActive || verifyBusyRef.current) return;
    setScanMessage("");
    setVerifyError("");
    scanDecodeLockRef.current = false;
    setScanActive(true);
  }

  function handleScanStop() {
    stopScanSession();
  }

  return (
          <section
            id="check-arrival"
            data-testid="check-arrival"
            className="scroll-mt-28 overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card lg:sticky lg:top-[7.5rem]"
          >
            <h2 className="text-label uppercase tracking-wide text-text-muted">
              Check arrival
            </h2>
            <p className="mt-1 text-xs leading-5 text-text-secondary" data-testid="verify-disclaimer">
              A scan confirms this token is waiting in the line, not identity. You can still type a bare token.
            </p>

            {/* Scan pass primary; manual Pass or token + Verify always secondary. */}
            <div className="mt-3 flex flex-col gap-3">
              <Button
                type="button"
                variant="default"
                size="lg"
                onClick={handleScanPass}
                disabled={scanDisabled || scanActive || verifyBusy}
                data-testid="scan-pass"
                className="w-full"
              >
                Scan pass
              </Button>

              {scanActive ? (
                <div
                  className="flex flex-col gap-2"
                  data-testid="scan-panel"
                >
                  {/* Forest frame on camera viewport (signature flourish). */}
                  <div className="overflow-hidden rounded-lg border-2 border-primary bg-secondary shadow-inner">
                    <video
                      ref={videoRef}
                      className="aspect-video max-h-[280px] w-full object-cover"
                      playsInline
                      muted
                      autoPlay
                      data-testid="scan-video"
                      aria-label="Camera preview for pass scan"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleScanStop}
                    data-testid="scan-stop"
                    className="w-full"
                  >
                    Stop
                  </Button>
                </div>
              ) : null}

              {scanMessage ? (
                <p
                  className="text-sm text-text-muted"
                  data-testid="scan-message"
                  role="status"
                >
                  {scanMessage}
                </p>
              ) : null}
            </div>

            <form
              className="mt-3 flex flex-col gap-3"
              onSubmit={handleVerify}
              data-testid="verify-form"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="verify-value">Pass or token</Label>
                <Input
                  id="verify-value"
                  name="verifyValue"
                  value={verifyValue}
                  onChange={(e) => {
                    setVerifyValue(e.target.value);
                    if (verifyResult || verifyError) {
                      setVerifyResult(null);
                      setVerifyError("");
                    }
                  }}
                  placeholder="Token or QIT:…"
                  disabled={verifyBusy}
                  data-testid="verify-input"
                  className="h-10"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                disabled={verifyBusy || !verifyValue.trim()}
                data-testid="verify-submit"
                className="w-full"
              >
                {verifyBusy ? "Checking…" : "Verify"}
              </Button>
            </form>

            {verifyError && (
              <div className="mt-3" data-testid="verify-error">
                <Alert variant="destructive">{verifyError}</Alert>
              </div>
            )}

            {verifyResult && (
              <div
                data-testid="verify-result"
                data-verified={verifyResult.verified ? "true" : "false"}
                className={cn(
                  "mt-3 flex flex-col gap-1 rounded-lg border px-4 py-3",
                  verifyResult.verified
                    ? /* success mist wash — forest primary mist, not whole-console décor */
                      "border-primary/30 bg-primary-muted"
                    : "border-border bg-secondary"
                )}
              >
                {verifyResult.verified ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-success">
                      Token is waiting
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {verifyResult.entry?.isGuest
                        ? "Guest"
                        : verifyResult.entry?.user?.name ||
                          (verifyResult.entry?.isWalkIn ? "Walk-in" : "User")}
                    </p>
                    <p className="text-xs text-text-muted">
                      Token{" "}
                      <span
                        className="font-metric font-bold tabular-nums text-foreground"
                        data-testid="verify-token"
                      >
                        {verifyResult.entry?.tokenNumber}
                      </span>
                      {" · "}Position {verifyResult.entry?.position}
                      {!verifyResult.entry?.isGuest && verifyResult.entry?.user?.email
                        ? ` · ${verifyResult.entry.user.email}`
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">No match</p>
                    <p className="text-xs text-text-muted">{verifyResult.reason}</p>
                  </>
                )}
              </div>
            )}
          </section>

  );
}
