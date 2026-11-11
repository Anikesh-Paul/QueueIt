import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { joinUrl } from "@/lib/join-link";

/**
 * Printable / shareable poster QR — opens `/join/:queueId`.
 * Distinct from the arrival pass a student shows at the counter.
 */
export function AdminPosterQr({ queueId, queueName }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = useMemo(() => joinUrl(origin, queueId), [origin, queueId]);

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
          className="shrink-0 rounded-lg border border-border bg-card p-3 shadow-card"
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
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={copyLink}
            data-testid="poster-copy"
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </section>
  );
}
