import { Button } from "@/components/ui/button";
import { useQueueNotify } from "@/hooks/use-queue-notifications";

/**
 * Explains Web Notification permission and optional sound/vibrate.
 * Denial leaves the in-page near-front banner working.
 */
export function NotifyControls() {
  const {
    supported,
    permission,
    enabled,
    sound,
    vibrate,
    requestEnable,
    setNotificationsOn,
    setSoundOn,
    setVibrateOn,
  } = useQueueNotify();

  if (!supported) {
    return (
      <div
        className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-text-secondary"
        data-testid="notify-unsupported"
      >
        This browser cannot show desktop notifications. The in-page banner still
        works when this page is open.
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3"
      data-testid="notify-controls"
    >
      <p className="text-sm font-medium text-foreground">Line notifications</p>
      {permission === "denied" ? (
        <p className="text-xs leading-5 text-text-secondary" data-testid="notify-permission-denied">
          Notifications are blocked for this site. The in-page banner still works
          while this page is open. Enable notifications for QueueIt in your browser
          settings if you want a desktop or lock-screen alert.
        </p>
      ) : enabled ? (
        <>
          <p className="text-xs leading-5 text-text-secondary" data-testid="notify-enabled-copy">
            We’ll notify you once when you reach the front of the line, or when
            you’re next. Alerts only work while this tab is open — even if it’s in
            the background. Closed or killed tabs need Web Push keys (see the README).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="notify-disable"
              onClick={() => setNotificationsOn(false)}
            >
              Turn off
            </Button>
            <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => setSoundOn(e.target.checked)}
                data-testid="notify-sound"
              />
              Sound
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={vibrate}
                onChange={(e) => setVibrateOn(e.target.checked)}
                data-testid="notify-vibrate"
              />
              Vibrate
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs leading-5 text-text-secondary">
            Get a notification when you’re near the front or next — useful if this
            tab is in the background. The in-page banner still works if you decline.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full sm:w-auto"
            data-testid="notify-enable"
            onClick={() => void requestEnable()}
          >
            Enable notifications
          </Button>
        </>
      )}
    </div>
  );
}
