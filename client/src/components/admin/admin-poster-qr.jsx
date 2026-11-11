import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { kioskUrl, posterPath, qrJoinUrl } from "@/lib/join-link";

/**
 * Printable / shareable poster QR — opens `/join/:queueId`.
 * Distinct from the arrival pass a student shows at the counter.
 */
export function AdminPosterQr({ queueId, queueName }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = useMemo(() => qrJoinUrl(origin, queueId), [origin, queueId]);
  const printPath = posterPath(queueId);
  const boardUrl = useMemo(() => kioskUrl(origin, queueId), [origin, queueId]);

  async function copyLink() {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (!url) return null;

  return (
    <section
      data-testid="poster-qr-card"
      className="scroll-mt-28 rounded-xl border border-border bg-card p-5 shadow-card"
    >
      <h2 className="font-display text-headline font-semibold tracking-[-0.01em] text-foreground">
        Poster QR
      </h2>
      <p className="mt-1 text-sm leading-5 text-text-secondary">
        Print or share this so people can join {queueName || "this queue"} from their
        phone. This is not an arrival pass.
      </p>
      <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div
          className="shrink-0 rounded-lg border border-border bg-white p-3 shadow-card"
          data-testid="poster-qr"
        >
          <QRCodeSVG
            value={url}
            size={160}
            level="M"
            marginSize={0}
            className="block h-40 w-40"
            role="img"
            aria-label={`Poster QR to join ${queueName || "this queue"}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            data-testid="poster-link"
            className="break-all font-mono text-xs leading-5 text-text-secondary"
          >
            {url}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={copyLink}
              data-testid="poster-copy"
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            {printPath ? (
              <Button variant="default" size="sm" asChild>
                <Link to={printPath} data-testid="poster-print-link">
                  Printable poster
                </Link>
              </Button>
            ) : null}
            {boardUrl ? (
              <Button
                variant="outline"
                size="sm"
                asChild
              >
                <a href={boardUrl} target="_blank" rel="noreferrer" data-testid="poster-kiosk">
                  Display board
                </a>
              </Button>
            ) : null}
          </div>
          {boardUrl ? (
            <p className="mt-3 text-xs text-text-muted">
              Open the display board on a TV or tablet and use full screen (or F11). It shows token numbers only and refreshes every few seconds.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
