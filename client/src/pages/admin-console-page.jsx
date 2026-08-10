import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useApp } from "@/context/app-context";
import { PageToolbar } from "@/components/shell/page-toolbar";
import { ShellContent } from "@/components/shell/shell-content";
import { RealtimeIndicator } from "@/components/realtime-indicator";
import { cn } from "@/lib/utils";
import { verifyArrival } from "@/api";
import {
  getCameraAvailability,
  SCAN_COPY,
  startQrScan,
} from "@/lib/qr-scanner";
import {
  campusDatetimeLocalToIso,
  formatCampusDateTime,
} from "@/lib/campus-time";

function formatNowServing(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * Admin console — medium-density waiting list + operate | Check arrival (lg+).
 * Phone: list first, arrival below (optional in-page jump — not sticky bottom bar).
 * Scan pass (camera) primary; Pass or token + Verify always first-class.
 * Serve stays on the list (verify-only — no serve-from-scan / F8).
 * No motif wallpaper; no production Admin API diagnostics.
 */
export function AdminConsolePage() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const {
    token,
    openAdminConsole,
    clearAdminConsole,
    adminQueueMeta,
    waitingList,
    waitingLoading,
    waitingError,
    adminActionBusy,
    adminActionError,
    selectedEntryId,
    setSelectedEntryId,
    adminServe,
    adminSkip,
    adminPause,
    adminResume,
    adminStopAccepting,
    adminStartAccepting,
    adminExtend,
    adminUpdateServiceWindows,
    adminReset,
    adminWalkIn,
    realtimeConnected,
  } = useApp();

  const [walkInName, setWalkInName] = useState("");
  const [walkInToken, setWalkInToken] = useState("");
  const [extendEndsAt, setExtendEndsAt] = useState("");
  const [reopenOverride, setReopenOverride] = useState("");
  /** Draft service windows for edit (campus IST HH:mm). */
  const [windowDraft, setWindowDraft] = useState([]);
  const [windowsDirty, setWindowsDirty] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
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
    if (queueId) openAdminConsole(queueId);
  }, [queueId, openAdminConsole]);

  // Sync draft from server meta unless the admin is mid-edit.
  useEffect(() => {
    if (windowsDirty) return;
    const rows = Array.isArray(adminQueueMeta?.serviceWindows)
      ? adminQueueMeta.serviceWindows.map((w) => ({
          start: w.start || "",
          end: w.end || "",
        }))
      : [];
    setWindowDraft(rows);
  }, [adminQueueMeta?.serviceWindows, windowsDirty]);

  useEffect(() => {
    setVerifyValue("");
    setVerifyResult(null);
    setVerifyError("");
    setWindowsDirty(false);
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
      clearAdminConsole();
    };
  }, [clearAdminConsole]);

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

  const paused = adminQueueMeta?.status === "paused";
  const acceptingTokens = adminQueueMeta?.acceptingTokens !== false;
  const queueName = adminQueueMeta?.name || "Queue";
  const empty = waitingList.length === 0;

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

  async function handleWalkIn(event) {
    event.preventDefault();
    if (adminActionBusy) return;
    const name = walkInName.trim();
    if (!name) return;
    const payload = { name };
    if (walkInToken.trim() !== "") {
      payload.tokenNumber = walkInToken.trim();
    }
    const ok = await adminWalkIn(payload);
    if (ok) {
      setWalkInName("");
      setWalkInToken("");
    }
  }

  function updateWindowRow(index, field, value) {
    setWindowsDirty(true);
    setWindowDraft((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addWindowRow() {
    setWindowsDirty(true);
    setWindowDraft((rows) => [...rows, { start: "", end: "" }]);
  }

  function removeWindowRow(index) {
    setWindowsDirty(true);
    setWindowDraft((rows) => rows.filter((_, i) => i !== index));
  }

  function normalizeTimeInput(value) {
    // HTML time may be HH:mm or HH:mm:ss — API stores HH:mm campus wall time.
    const raw = String(value ?? "").trim();
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
    if (!m) return raw;
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  }

  async function handleSaveWindows(event) {
    event.preventDefault();
    if (adminActionBusy) return;
    const payload = windowDraft.map((row) => ({
      start: normalizeTimeInput(row.start),
      end: normalizeTimeInput(row.end),
    }));
    const ok = await adminUpdateServiceWindows(payload);
    if (ok) setWindowsDirty(false);
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
    <>
      <PageToolbar
        tier="admin"
        title={<span data-testid="admin-queue-name">{queueName}</span>}
        meta={
          <>
            <span className="shrink-0">
              {realtimeConnected
                ? "Instant updates"
                : "Waiting list updates every few seconds"}
            </span>
            <RealtimeIndicator connected={realtimeConnected} testId="admin-realtime-status" />
            {waitingLoading ? <span className="shrink-0">· loading…</span> : null}
          </>
        }
        status={
          <span className="flex flex-wrap items-center gap-1.5">
            {!acceptingTokens ? (
              <span
                data-testid="admin-queue-accepting"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-text-secondary"
              >
                <span className="size-1.5 rounded-full bg-text-muted" />
                Closed
              </span>
            ) : null}
            <span
              data-testid="admin-queue-status"
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                paused ? "bg-[#FEF3C7] text-[#92400E]" : "bg-primary-muted text-primary"
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", paused ? "bg-[#D97706]" : "bg-primary")}
              />
              {paused ? "Paused" : "Open"}
            </span>
          </span>
        }
        actions={
          <>
            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={adminActionBusy}
                  data-testid="admin-reset"
                  className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
                >
                  Reset queue
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent data-testid="admin-reset-dialog">
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset {queueName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Clears the line and restarts tokens.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructiveSolid"
                    data-testid="admin-reset-confirm"
                    onClick={(event) => {
                      event.preventDefault();
                      setResetOpen(false);
                      adminReset();
                    }}
                  >
                    {adminActionBusy ? "Working…" : "Reset"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/admin/queues/${queueId}/analytics`)}
              data-testid="open-analytics"
            >
              Analytics
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/queues")}>
              Back to queues
            </Button>
          </>
        }
      />

      <ShellContent tier="admin">
        <header className="mb-6 flex items-end justify-between gap-4">
          <h1
            data-testid="admin-heading"
            className="font-heading text-headline leading-tight text-foreground"
          >
            Admin
          </h1>
          {/* Phone-only in-page jump — not a sticky bottom bar */}
          <a
            href="#check-arrival"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline lg:hidden"
            data-testid="jump-check-arrival"
          >
            Check arrival
          </a>
        </header>

        {/*
          ≥lg: waiting list + operate | Check arrival
          phone: list first, arrival below
        */}
        <div
          data-testid="admin-layout"
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,22rem)] lg:items-start lg:gap-5"
        >
          <div data-testid="admin-operate-column" className="flex min-w-0 flex-col gap-4">
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
              <div className="grid grid-cols-2 gap-3 px-5 py-5 sm:max-w-sm">
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Now serving
                  </span>
                  <span
                    className="font-metric text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
                    data-testid="admin-now-serving"
                  >
                    {formatNowServing(adminQueueMeta?.nowServing)}
                  </span>
                </div>
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-4 py-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Waiting
                  </span>
                  <span
                    className="font-metric text-2xl font-bold tracking-[-0.02em] tabular-nums text-foreground"
                    data-testid="admin-waiting-count"
                  >
                    {waitingList.length}
                  </span>
                </div>
              </div>

              <div className="border-t border-border px-5 py-4">
                <div
                  className="admin-actions grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
                  data-testid="admin-actions"
                >
                  <Button
                    variant="default"
                    size="lg"
                    onClick={() => adminServe(selectedEntryId || undefined)}
                    disabled={adminActionBusy || paused || empty}
                    data-testid="admin-serve"
                    className="w-full sm:w-auto"
                  >
                    {adminActionBusy
                      ? "Working…"
                      : selectedEntryId
                        ? "Serve selected"
                        : "Serve next"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => adminSkip(selectedEntryId || undefined)}
                    disabled={adminActionBusy || paused || empty}
                    data-testid="admin-skip"
                    className="w-full sm:w-auto"
                  >
                    {adminActionBusy
                      ? "Working…"
                      : selectedEntryId
                        ? "Skip selected"
                        : "Skip next"}
                  </Button>
                  {paused ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={adminResume}
                      disabled={adminActionBusy}
                      data-testid="admin-resume"
                      className="w-full sm:w-auto"
                    >
                      {adminActionBusy ? "Working…" : "Resume"}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={adminPause}
                      disabled={adminActionBusy}
                      data-testid="admin-pause"
                      className="w-full sm:w-auto"
                    >
                      {adminActionBusy ? "Working…" : "Pause"}
                    </Button>
                  )}
                  {acceptingTokens ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => {
                        const reopenAt = campusDatetimeLocalToIso(reopenOverride);
                        adminStopAccepting(reopenAt ? { reopenAt } : {});
                        setReopenOverride("");
                      }}
                      disabled={adminActionBusy}
                      data-testid="admin-stop-accepting"
                      className="col-span-2 w-full sm:col-auto sm:w-auto"
                    >
                      {adminActionBusy ? "Working…" : "Stop accepting tokens"}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={adminStartAccepting}
                      disabled={adminActionBusy}
                      data-testid="admin-start-accepting"
                      className="col-span-2 w-full sm:col-auto sm:w-auto"
                    >
                      {adminActionBusy ? "Working…" : "Start accepting tokens"}
                    </Button>
                  )}
                </div>

                {acceptingTokens ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <div
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                      data-testid="admin-stop-reopen-panel"
                    >
                      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                        <Label
                          htmlFor="reopen-override"
                          className="text-xs text-text-muted"
                        >
                          Reopen override (optional, campus IST)
                        </Label>
                        <Input
                          id="reopen-override"
                          type="datetime-local"
                          value={reopenOverride}
                          onChange={(e) => setReopenOverride(e.target.value)}
                          data-testid="admin-reopen-override"
                          disabled={adminActionBusy}
                        />
                      </div>
                      <p className="text-xs text-text-muted sm:pb-2">
                        Leave empty for next scheduled window start.
                      </p>
                    </div>
                    <div
                      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                      data-testid="admin-extend-panel"
                    >
                      <p className="w-full text-sm text-text-muted">
                        Extend auto-close
                        {adminQueueMeta?.sessionEndsAt
                          ? ` · ends ${formatCampusDateTime(adminQueueMeta.sessionEndsAt)}`
                          : ""}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={adminActionBusy}
                        data-testid="admin-extend-15"
                        onClick={() => adminExtend({ minutes: 15 })}
                      >
                        +15 min
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={adminActionBusy}
                        data-testid="admin-extend-30"
                        onClick={() => adminExtend({ minutes: 30 })}
                      >
                        +30 min
                      </Button>
                      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                        <Label
                          htmlFor="extend-ends-at"
                          className="text-xs text-text-muted"
                        >
                          Explicit end (campus IST)
                        </Label>
                        <Input
                          id="extend-ends-at"
                          type="datetime-local"
                          value={extendEndsAt}
                          onChange={(e) => setExtendEndsAt(e.target.value)}
                          data-testid="admin-extend-ends-at"
                          disabled={adminActionBusy}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={adminActionBusy || !extendEndsAt}
                        data-testid="admin-extend-apply"
                        onClick={() => {
                          const endsAt = campusDatetimeLocalToIso(extendEndsAt);
                          if (!endsAt) return;
                          adminExtend({ endsAt });
                        }}
                      >
                        Set end
                      </Button>
                    </div>
                  </div>
                ) : null}

                {(waitingError || adminActionError) && (
                  <div className="mt-3 flex flex-col gap-2">
                    {waitingError && <Alert variant="destructive">{waitingError}</Alert>}
                    {adminActionError && (
                      <Alert variant="destructive" data-testid="admin-action-error">
                        {adminActionError}
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section
              className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card"
              data-testid="admin-service-windows"
            >
              <h2 className="text-label uppercase tracking-wide text-text-muted">
                Service windows
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                Daily schedule (same every day). Times are campus IST.
              </p>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={handleSaveWindows}
                data-testid="admin-service-windows-form"
              >
                <ul className="flex flex-col gap-2" data-testid="admin-service-windows-list">
                  {windowDraft.length === 0 ? (
                    <li className="text-sm text-text-muted" data-testid="admin-service-windows-empty">
                      No windows yet — add at least one for auto-close and reopen guidance.
                    </li>
                  ) : (
                    windowDraft.map((row, index) => (
                      <li
                        key={`window-${index}`}
                        className="flex flex-wrap items-end gap-2"
                        data-testid={`admin-service-window-row-${index}`}
                      >
                        <div className="flex min-w-[6.5rem] flex-col gap-1">
                          <Label
                            htmlFor={`sw-start-${index}`}
                            className="text-xs text-text-muted"
                          >
                            Starts
                          </Label>
                          <Input
                            id={`sw-start-${index}`}
                            type="time"
                            value={row.start}
                            onChange={(e) =>
                              updateWindowRow(index, "start", e.target.value)
                            }
                            disabled={adminActionBusy}
                            data-testid={`admin-service-window-start-${index}`}
                            className="h-10"
                            required
                          />
                        </div>
                        <div className="flex min-w-[6.5rem] flex-col gap-1">
                          <Label
                            htmlFor={`sw-end-${index}`}
                            className="text-xs text-text-muted"
                          >
                            Ends
                          </Label>
                          <Input
                            id={`sw-end-${index}`}
                            type="time"
                            value={row.end}
                            onChange={(e) =>
                              updateWindowRow(index, "end", e.target.value)
                            }
                            disabled={adminActionBusy}
                            data-testid={`admin-service-window-end-${index}`}
                            className="h-10"
                            required
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={adminActionBusy}
                          onClick={() => removeWindowRow(index)}
                          data-testid={`admin-service-window-remove-${index}`}
                        >
                          Remove
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={adminActionBusy}
                    onClick={addWindowRow}
                    data-testid="admin-service-window-add"
                  >
                    Add window
                  </Button>
                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={adminActionBusy}
                    data-testid="admin-service-windows-save"
                  >
                    {adminActionBusy ? "Working…" : "Save windows"}
                  </Button>
                </div>
              </form>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card">
              <h2 className="text-label uppercase tracking-wide text-text-muted">Walk-in</h2>
              <form
                className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
                onSubmit={handleWalkIn}
                data-testid="walk-in-form"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:min-w-[12rem]">
                  <Label htmlFor="walk-in-name">Name</Label>
                  <Input
                    id="walk-in-name"
                    name="walkInName"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    placeholder="Name at counter"
                    required
                    maxLength={80}
                    disabled={adminActionBusy}
                    data-testid="walk-in-name"
                    className="h-10"
                  />
                </div>
                <div className="flex w-full flex-col gap-1.5 sm:w-28">
                  <Label htmlFor="walk-in-token">Token (optional)</Label>
                  <Input
                    id="walk-in-token"
                    name="walkInToken"
                    type="number"
                    min={1}
                    step={1}
                    value={walkInToken}
                    onChange={(e) => setWalkInToken(e.target.value)}
                    placeholder="Auto"
                    disabled={adminActionBusy}
                    data-testid="walk-in-token"
                    className="h-10"
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  disabled={adminActionBusy || !walkInName.trim()}
                  data-testid="walk-in-submit"
                  className="w-full sm:w-auto"
                >
                  {adminActionBusy ? "Working…" : "Add walk-in"}
                </Button>
              </form>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card">
              <h2 className="text-label uppercase tracking-wide text-text-muted">
                Waiting list
              </h2>

              {waitingLoading && (
                <div className="mt-3 flex flex-col gap-2" aria-busy="true">
                  <Skeleton className="h-12 rounded-lg" />
                  <Skeleton className="h-12 rounded-lg" />
                </div>
              )}

              {!waitingLoading && empty && (
                <p className="mt-3 text-sm text-text-muted" data-testid="admin-waiting-empty">
                  No one waiting.
                </p>
              )}

              {!waitingLoading && !empty && (
                <ul className="mt-3 flex flex-col gap-2" data-testid="admin-waiting-list">
                  {waitingList.map((entry) => {
                    const isSelected = entry.id === selectedEntryId;
                    const isWalkIn = Boolean(entry.isWalkIn);
                    const isGuest = Boolean(entry.isGuest) && !isWalkIn;
                    // Token-first rows: Guest badge only (no name/email); walk-in keeps name.
                    const displayName = isGuest
                      ? null
                      : entry.user?.name || (isWalkIn ? "Walk-in" : "User");
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-left shadow-card outline-none transition-[border,background-color] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/50",
                            isSelected && "border-primary bg-primary-muted/60"
                          )}
                          onClick={() =>
                            setSelectedEntryId((prev) => (prev === entry.id ? null : entry.id))
                          }
                          aria-pressed={isSelected}
                          data-testid="waiting-entry"
                          data-token={entry.tokenNumber}
                          data-walk-in={isWalkIn ? "true" : "false"}
                          data-guest={isGuest ? "true" : "false"}
                        >
                          <span className="w-10 shrink-0 font-metric text-base font-bold tabular-nums text-foreground">
                            #{entry.tokenNumber}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                              {displayName ? <span className="truncate">{displayName}</span> : null}
                              {isGuest ? (
                                <span
                                  className="badge--guest shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-text-secondary ring-1 ring-border"
                                  data-testid="waiting-guest-badge"
                                >
                                  Guest
                                </span>
                              ) : null}
                              {isWalkIn ? (
                                <span className="ml-0.5 text-xs font-semibold text-text-muted">
                                  · Walk-in
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-text-muted">
                              Position {entry.position}
                              {!isGuest && entry.user?.email ? ` · ${entry.user.email}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section
            id="check-arrival"
            data-testid="check-arrival"
            className="scroll-mt-28 overflow-hidden rounded-xl border border-border bg-card px-5 py-5 shadow-card lg:sticky lg:top-[7.5rem]"
          >
            <h2 className="text-label uppercase tracking-wide text-text-muted">
              Check arrival
            </h2>

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
                      Arrival confirmed
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
        </div>
      </ShellContent>
    </>
  );
}
