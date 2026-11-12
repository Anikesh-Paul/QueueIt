import { useId, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { sendFeedback } from "@/api";
import { COMMENT_MAX, ratingWordKey } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/** Five stars as a radio group: arrow keys move, Enter/Space picks. */
export function StarPicker({ value, onChange, label, disabled }) {
  const { t } = useI18n();
  function onKeyDown(event) {
    if (!["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    const next = Math.min(5, Math.max(1, (value || 0) + step));
    onChange(next);
    event.currentTarget.querySelector(`[data-star="${next}"]`)?.focus();
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1" onKeyDown={onKeyDown}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        const checked = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${n} · ${t(ratingWordKey(n))}`}
            tabIndex={checked || (value == null && n === 1) ? 0 : -1}
            data-star={n}
            data-testid={`feedback-star-${n}`}
            disabled={disabled}
            onClick={() => onChange(n)}
            className="rounded-md p-1 outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:opacity-60"
          >
            <Star
              className={cn("size-7", on ? "fill-attention text-attention" : "fill-transparent text-text-muted")}
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Rate one served visit. Comment is optional and appears once a star is picked.
 */
export function FeedbackForm({ visit, onSubmitted, onDismiss, testId = "feedback-form" }) {
  const { token, guestCredential } = useApp();
  const { t } = useI18n();
  const commentId = useId();
  const [rating, setRating] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!rating || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendFeedback(token, { entryId: visit.entryId, rating, comment }, guestCredential);
      setDone(true);
      onSubmitted?.(rating);
    } catch (err) {
      setError(err?.data?.code === "already-rated" ? t("feedback.already") : err?.message || t("feedback.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p role="status" className="text-sm font-medium text-success" data-testid={`${testId}-thanks`}>
        {t("feedback.thanks")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} data-testid={testId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarPicker value={rating} onChange={setRating} label={t("feedback.ratingLabel")} disabled={busy} />
        <span className="text-sm text-text-secondary" aria-live="polite" data-testid={`${testId}-word`}>
          {rating ? t(ratingWordKey(rating)) : t("feedback.pick")}
        </span>
      </div>
      {rating ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={commentId} className="text-sm font-medium text-foreground">
            {t("feedback.commentLabel")} <span className="font-normal text-text-muted">{t("feedback.optional")}</span>
          </label>
          <textarea
            id={commentId}
            value={comment}
            maxLength={COMMENT_MAX}
            rows={2}
            onChange={(e) => setComment(e.target.value)}
            placeholder={rating <= 2 ? t("feedback.placeholderLow") : t("feedback.placeholder")}
            data-testid={`${testId}-comment`}
            className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-text-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <span className="self-end text-xs text-text-muted tabular-nums">
            {comment.length}/{COMMENT_MAX}
          </span>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger-ink" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!rating || busy} data-testid={`${testId}-send`}>
          {busy ? t("feedback.sending") : t("feedback.send")}
        </Button>
        {onDismiss ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss} data-testid={`${testId}-dismiss`}>
            {t("feedback.notNow")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Read-only stars for a rating already left. */
export function RatingStars({ rating, className }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={t("feedback.youRated", { rating })} role="img">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn("size-3.5", n <= rating ? "fill-attention text-attention" : "fill-transparent text-text-muted")}
          strokeWidth={1.6}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
