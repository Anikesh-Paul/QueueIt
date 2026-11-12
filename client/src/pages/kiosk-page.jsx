import { useCallback, useEffect, useState } from "react";
import { NoticeList } from "@/components/notices/notice-list";
import { useNotices } from "@/hooks/use-notices";
import { useParams } from "react-router-dom";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { QRCodeSVG } from "qrcode.react";
import { getQueueBoard } from "@/api";
import { qrJoinUrl } from "@/lib/join-link";
import { presentServingBoard } from "@/lib/now-serving";
import { formatWaitingOccupancy } from "@/lib/waiting-occupancy";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;

/**
 * Public now-serving board for a TV or tablet at the counter.
 * Token numbers only — no student names or emails.
 */
export function KioskPage() {
  const { queueId } = useParams();
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const notices = useNotices(queueId, { enabled: Boolean(queueId) });

  const load = useCallback(async () => {
    if (!queueId) return;
    try {
      const data = await getQueueBoard(queueId);
      setBoard(data.queue);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message || "Could not load the display board.");
    }
  }, [queueId]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      await load();
    }
    tick();
    const id = window.setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  async function openFullScreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Browser blocked it; the README also documents F11 / the browser menu.
    }
  }

  const presented = presentServingBoard(board?.counters || []);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const scanUrl = qrJoinUrl(origin, queueId);
  const showScan = Boolean(board && scanUrl && board.acceptingTokens !== false && board.guestJoin !== false);
  const statusLabel = !board
    ? ""
    : board.acceptingTokens === false
      ? "Closed"
      : board.status === "paused"
        ? "Paused"
        : "Open";

  return (
    <div
      className="flex min-h-dvh flex-col bg-background px-4 py-4 sm:px-8 sm:py-6"
      data-testid="kiosk-board"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={openFullScreen}
            data-testid="kiosk-fullscreen"
          >
            Open full screen
          </Button>
        </div>
      </header>

      {error && !board ? (
        <p className="mt-16 text-center text-lg text-text-secondary" data-testid="kiosk-error">
          {error}
        </p>
      ) : !board ? (
        <p className="mt-16 text-center text-lg text-text-muted" data-testid="kiosk-loading">
          Loading board…
        </p>
      ) : (
        <main
          className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 py-8"
          data-testid="kiosk-main"
        >
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-text-muted">
              {board.venue?.name || "Campus"}
            </p>
            <h1
              className="mt-1 font-display text-4xl font-semibold tracking-[-0.03em] text-foreground sm:text-6xl"
              data-testid="kiosk-queue-name"
            >
              {board.name}
            </h1>
            <p className="mt-3 flex flex-wrap items-center justify-center gap-3 text-base text-text-secondary">
              <span
                data-testid="kiosk-status"
                className={cn(
                  "rounded-full px-3 py-0.5 text-sm font-semibold",
                  statusLabel === "Closed" && "bg-secondary text-text-secondary",
                  statusLabel === "Paused" && "bg-warning-soft text-warning-ink",
                  statusLabel === "Open" && "bg-primary-muted text-primary"
                )}
              >
                {statusLabel}
              </span>
              <span data-testid="kiosk-waiting">{formatWaitingOccupancy({ waitingCount: board.waitingCount })}</span>
            </p>
          </div>

          <NoticeList notices={notices} hideable={false} className="w-full max-w-3xl" />

          <ul
            className={cn(
              "grid w-full gap-4",
              presented.rows.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1"
            )}
            data-testid="kiosk-counters"
          >
            {presented.rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-10 shadow-card"
                data-testid="kiosk-counter"
              >
                {presented.multi && row.name ? (
                  <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                    {row.name}
                  </p>
                ) : null}
                <p className="mt-2 text-sm font-medium uppercase tracking-wide text-text-secondary">
                  {row.label}
                </p>
                <p
                  className="mt-2 font-display text-7xl font-semibold leading-none tracking-[-0.04em] text-foreground sm:text-8xl"
                  data-testid="kiosk-token"
                >
                  {row.value}
                </p>
              </li>
            ))}
          </ul>

          {showScan ? (
            <section
              data-testid="kiosk-scan-to-join"
              aria-label={`Scan to join ${board.name}`}
              className="flex w-full max-w-xl flex-col items-center gap-5 rounded-xl border border-border bg-card px-6 py-5 shadow-card sm:flex-row"
            >
              <div className="shrink-0 rounded-lg bg-white p-2.5">
                <QRCodeSVG
                  value={scanUrl}
                  size={132}
                  level="M"
                  marginSize={0}
                  className="block size-32"
                  role="img"
                  aria-label={`QR code to join ${board.name}`}
                />
              </div>
              <div className="text-center sm:text-left">
                <p className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">Scan to join</p>
                <p className="mt-1 text-base text-text-secondary">
                  Point your phone camera at the code. No app or account needed, and you&apos;ll get your token on your phone.
                </p>
              </div>
            </section>
          ) : null}

          <p className="text-center text-xs text-text-muted">
            Token numbers only. This board refreshes every few seconds.
            {updatedAt ? " Use full screen on a TV or tablet at the counter." : ""}
          </p>
        </main>
      )}
    </div>
  );
}
