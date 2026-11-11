import { Button } from "@/components/ui/button";
import { useQueueNotify } from "@/hooks/use-queue-notifications";
import { useI18n } from "@/context/i18n-context";

/**
 * Student/guest control to watch a closed queue and be notified in-page
 * when it starts accepting again. Hidden when notifications are unsupported
 * or permission was denied (quietly no-op — no error copy here).
 */
export function OpenWatchControls({ queue, className = "" } = {}) {
  const { supported, permission, isWatchingOpen, requestOpenWatch, cancelOpenWatch } =
    useQueueNotify();
  const { t } = useI18n();

  if (!queue?.id || queue.acceptingTokens !== false) return null;
  if (!supported || permission === "denied") return null;

  const watching = isWatchingOpen(queue.id);

  if (watching) {
    return (
      <div className={className} data-testid="open-watch-controls">
        <p className="text-sm text-text-secondary" data-testid="open-watch-pending">
          {t("watch.pending", { name: queue.name || t("watch.thisQueue") })}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1"
          data-testid="open-watch-cancel"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelOpenWatch(queue.id);
          }}
        >
          {t("watch.cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className={className} data-testid="open-watch-controls">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="open-watch-subscribe"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          requestOpenWatch(queue.id);
        }}
      >
        {t("watch.subscribe")}
      </Button>
    </div>
  );
}
