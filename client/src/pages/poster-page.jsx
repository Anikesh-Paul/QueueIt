import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { useApp } from "@/context/app-context";
import { fetchQueues } from "@/api";
import { isQueueId, qrJoinUrl } from "@/lib/join-link";
import { displayLink, formatServiceHours } from "@/lib/poster";
import { staffCanManageQueue } from "@/lib/staff-access";

/**
 * Printable A4 poster for one queue: big scan-to-join QR, hours, and how it
 * works. Screen view adds a toolbar that is hidden when printing.
 */
export function PosterPage() {
  const { queueId } = useParams();
  const { user } = useApp();
  const [queue, setQueue] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    if (!isQueueId(queueId || "")) {
      setState("missing");
      return undefined;
    }
    let cancelled = false;
    fetchQueues(null, null)
      .then((data) => {
        if (cancelled) return;
        const found = (data.queues || []).find((q) => q.id === queueId);
        setQueue(found || null);
        setState(found ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [queueId]);

  useEffect(() => {
    if (queue?.name) document.title = `${queue.name} poster · QueueIt`;
    return () => {
      document.title = "QueueIt";
    };
  }, [queue?.name]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = qrJoinUrl(origin, queueId);
  const allowed = queue ? staffCanManageQueue(user, queue) : true;
  const hours = formatServiceHours(queue?.serviceWindows);

  const toolbar = (
    <div className="poster-toolbar mx-auto mb-6 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
      <Button variant="ghost" size="sm" asChild>
        <Link to={`/admin/queues/${queueId}`} data-testid="poster-back">
          Back to console
        </Link>
      </Button>
      <div className="flex items-center gap-2">
        <p className="hidden text-xs text-text-muted sm:block">A4 portrait · turn off headers and footers</p>
        <Button size="sm" onClick={() => window.print()} disabled={state !== "ready" || !allowed} data-testid="poster-print">
          Print poster
        </Button>
      </div>
    </div>
  );

  if (state !== "ready" || !allowed) {
    const message =
      state === "loading"
        ? "Loading poster…"
        : state === "error"
          ? "We couldn't load this queue. Check your connection and try again."
          : !allowed
            ? "You don't have access to this queue."
            : "This queue doesn't exist or has been archived.";
    return (
      <div className="min-h-dvh bg-background px-4 py-6">
        {toolbar}
        <p className="mx-auto mt-16 max-w-md text-center text-text-secondary" role={state === "loading" ? "status" : "alert"} data-testid="poster-state">
          {message}
        </p>
      </div>
    );
  }

  return (
    <div className="poster-screen min-h-dvh bg-background px-4 py-6 print:bg-white print:p-0">
      {toolbar}
      <article
        data-testid="poster-sheet"
        className="poster-sheet mx-auto flex w-full max-w-[210mm] flex-col items-center rounded-lg border border-border bg-white px-8 py-10 text-center text-[#1a1a18] shadow-lift sm:px-14 sm:py-14 print:rounded-none print:border-0 print:shadow-none"
      >
        <div className="flex w-full items-center justify-between text-left">
          <Wordmark className="pointer-events-none" />
          <span className="text-sm font-medium uppercase tracking-[0.08em] text-[#57534e]">{queue.venue?.name || "Campus"}</span>
        </div>

        <h1 className="mt-10 font-display text-5xl font-semibold leading-tight tracking-[-0.02em] sm:text-6xl" data-testid="poster-queue-name">
          {queue.name}
        </h1>
        <p className="mt-3 text-xl text-[#57534e]">Skip the line. Join from your phone.</p>

        <div className="mt-10 rounded-2xl border-2 border-[#1b4332] p-5" data-testid="poster-sheet-qr">
          <QRCodeSVG
            value={url}
            size={320}
            level="Q"
            marginSize={0}
            className="block size-[62vw] max-h-[85mm] max-w-[85mm]"
            role="img"
            aria-label={`QR code to join ${queue.name}`}
          />
        </div>
        <p className="mt-4 text-2xl font-semibold tracking-[-0.01em]">Scan to join</p>
        <p className="mt-1 max-w-full break-all font-mono text-sm text-[#57534e]" data-testid="poster-sheet-link">{displayLink(url)}</p>

        <ol className="mt-10 grid w-full gap-4 text-left sm:grid-cols-3">
          {[
            ["1", "Scan", "Open your phone camera and point it at the code."],
            ["2", "Join", "Tap Join. No app or account needed."],
            ["3", "Come back", "Watch your place live and return when you're called."],
          ].map(([n, title, body]) => (
            <li key={n} className="rounded-lg border border-[#e7e5e4] px-4 py-3">
              <p className="text-sm font-semibold">
                <span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-[#1b4332] text-xs text-white">{n}</span>
                {title}
              </p>
              <p className="mt-1 text-sm leading-snug text-[#57534e]">{body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex w-full flex-col gap-1 border-t border-[#e7e5e4] pt-5 text-left text-sm text-[#57534e] sm:flex-row sm:justify-between sm:gap-6">
          <p data-testid="poster-hours">
            <span className="font-semibold text-[#1a1a18]">Hours (IST): </span>
            {hours.length ? hours.join(" · ") : "Ask at the counter"}
          </p>
          <p>
            <span className="font-semibold text-[#1a1a18]">Need priority? </span>
            Ask in the app after joining, or speak to staff.
          </p>
        </div>
        {queue.guestJoin === false ? (
          <p className="mt-4 w-full rounded-md bg-[#efece4] px-3 py-2 text-left text-sm print:hidden" data-testid="poster-guest-off">
            Scan-to-join without login is off for this queue, so people will be asked to sign in. You can change this in the catalog.
          </p>
        ) : null}
      </article>
    </div>
  );
}
