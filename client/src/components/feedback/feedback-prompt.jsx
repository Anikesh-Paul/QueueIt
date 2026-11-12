import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { fetchPendingFeedback } from "@/api";
import { formatCampusDateTime } from "@/lib/campus-time";
import { nextPrompt, readDismissed, writeDismissed } from "@/lib/feedback";
import { FeedbackForm } from "./feedback-form";

/**
 * "How was Cafeteria?" — shown on the queues page after someone is served.
 * One visit at a time; "Not now" hides that visit on this device.
 */
export function FeedbackPrompt() {
  const { token, guestCredential, isAdmin } = useApp();
  const { t, locale } = useI18n();
  const [pending, setPending] = useState([]);
  const [dismissed, setDismissed] = useState(() => readDismissed());
  const [sentId, setSentId] = useState(null);

  useEffect(() => {
    if (isAdmin || (!token && !guestCredential)) return undefined;
    let cancelled = false;
    fetchPendingFeedback(token, guestCredential)
      .then((data) => {
        if (!cancelled) setPending(data?.pending || []);
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, guestCredential, isAdmin]);

  const visit = sentId ? pending.find((row) => row.entryId === sentId) : nextPrompt(pending, dismissed);
  if (!visit) return null;

  function dismiss() {
    const next = [...dismissed, visit.entryId];
    writeDismissed(next);
    setDismissed(next);
    setSentId(null);
  }

  const meta = [
    t("feedback.promptMeta", { token: visit.tokenNumber, when: formatCampusDateTime(visit.servedAt, locale) }),
    visit.counterName ? t("feedback.promptCounter", { counter: visit.counterName }) : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      aria-labelledby="feedback-prompt-title"
      data-testid="feedback-prompt"
      className="relative mb-5 rounded-lg border border-border bg-card px-4 py-4 shadow-card sm:px-5"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("feedback.notNow")}
        className="absolute top-2.5 right-2.5 rounded-md p-1.5 text-text-muted outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <h2 id="feedback-prompt-title" className="pr-8 font-heading text-base font-semibold text-foreground">
        {t("feedback.promptTitle", { queue: visit.queue?.name || t("common.queue") })}
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-text-muted">{meta}</p>
      <FeedbackForm
        key={visit.entryId}
        visit={visit}
        testId="feedback-prompt-form"
        onSubmitted={() => setSentId(visit.entryId)}
        onDismiss={sentId ? null : dismiss}
      />
    </section>
  );
}
