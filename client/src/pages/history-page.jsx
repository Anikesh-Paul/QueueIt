import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { useApp } from "@/context/app-context";
import { ShellContent } from "@/components/shell/shell-content";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { SoftUpgradePrompt } from "@/components/shell/soft-upgrade-prompt";
import { formatCampusDateTime } from "@/lib/campus-time";
import { cn } from "@/lib/utils";
import { useI18n } from "@/context/i18n-context";

function formatOutcomeLabel(outcome, t) {
  if (!outcome) return "—";
  const key = `history.outcome.${outcome}`;
  const label = t(key);
  return label === key ? String(outcome).charAt(0).toUpperCase() + String(outcome).slice(1) : label;
}

/**
 * History (User, portable) or device-local history (Guest, this device).
 * After soft upgrade, events are claimed onto portable User History.
 * Ruthless copy: H1 History; empty primary + one secondary; Guest empty may reinforce upgrade.
 */
export function HistoryPage() {
  const { t, locale } = useI18n();
  const {
    token,
    guestCredential,
    isGuest,
    historyEvents,
    historyLoading,
    historyError,
    historyHasMore,
    historyNextCursor,
    historyLoadingMore,
    loadHistory,
  } = useApp();

  useEffect(() => {
    if (token || guestCredential) {
      loadHistory(token || null, guestCredential || null);
    }
  }, [token, guestCredential, loadHistory]);

  return (
    <ShellContent tier="student">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1
          data-testid="history-heading"
          className="font-heading text-headline leading-tight text-foreground"
        >
          {t("history.title")}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadHistory(token || null, guestCredential || null)}
          disabled={historyLoading}
          className="hidden sm:inline-flex"
          data-testid="history-refresh"
        >
          {t("common.refresh")}
        </Button>
      </header>

      {historyLoading && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("history.loading")}>
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      )}

      {!historyLoading && historyError && (
        <ErrorState
          testId="history-error"
          title={t("error.loadHistory")}
          message={t("error.connection")}
          detail={historyError}
          retryLabel={t("error.retry")}
          onRetry={() => loadHistory(token || null, guestCredential || null)}
        />
      )}

      {!historyLoading && !historyError && historyEvents.length === 0 && (
        <div
          data-testid="history-empty"
          className="rounded-md border border-border bg-card px-5 py-12 text-center shadow-card"
        >
          <MotifIllustration motif="foldedPass" variant="empty" className="mb-4" />
          <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
            {t("history.empty")}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {isGuest ? t("history.emptyGuest") : t("history.emptyUser")}
          </p>
          {isGuest ? (
            <SoftUpgradePrompt
              className="mx-auto mt-6 max-w-sm text-left"
              testId="soft-upgrade-history-empty"
            />
          ) : null}
        </div>
      )}

      {!historyLoading && !historyError && historyEvents.length > 0 && (
        <ul className="flex flex-col gap-3" data-testid="history-list" aria-label={t("history.listLabel")}>
          {historyEvents.map((event) => (
            <li
              key={event.id}
              data-testid="history-item"
              data-outcome={event.outcome}
              className="rounded-md border border-border bg-card p-4 shadow-card"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    outcomeTone(event.outcome)
                  )}
                  data-testid="history-outcome"
                >
                  {formatOutcomeLabel(event.outcome, t)}
                </span>
                <span className="text-xs font-semibold text-text-secondary">
                  {t("history.token", { token: event.tokenNumber })}
                </span>
              </div>
              <p className="mt-2 font-heading text-sm font-medium text-foreground">
                {event.queue?.name || t("common.queue")}
              </p>
              <p className="mt-0.5 text-xs text-text-muted" data-testid="history-event-time">
                {formatCampusDateTime(
                  event.outcome === "joined" ? event.joinedAt : event.updatedAt || event.joinedAt,
                  locale
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!historyLoading && !historyError && historyHasMore ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            size="lg"
            disabled={historyLoadingMore}
            onClick={() =>
              loadHistory(token || null, guestCredential || null, {
                append: true,
                cursor: historyNextCursor,
              })
            }
            data-testid="history-load-more"
            className="w-full sm:w-auto"
          >
            {historyLoadingMore ? t("history.loadingMore") : t("history.loadMore")}
          </Button>
        </div>
      ) : null}
    </ShellContent>
  );
}

function outcomeTone(outcome) {
  switch (outcome) {
    case "joined":
      return "bg-primary-muted text-primary";
    case "served":
      return "bg-primary-muted text-success";
    case "skipped":
      return "bg-warning-soft text-warning-ink";
    default:
      return "bg-secondary text-text-secondary";
  }
}
