import { Button } from "@/components/ui/button";
import { useQueueNotify } from "@/hooks/use-queue-notifications";
import { notifyControlsMode } from "@/lib/notify-controls";

/**
 * Compact Web Notification control. Does not sit above the token hero.
 * Denial leaves the in-page near-front banner working.
 */
export function NotifyControls({ called = false } = {}) {
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

  const mode = notifyControlsMode({ supported, permission, enabled, called });

  if (mode === "hidden") return null;

  if (mode === "unsupported") {
    return (
      <p
        className="text-sm text-text-secondary"
        data-testid="notify-unsupported"
      >
        This browser cannot show desktop notifications. The in-page banner still
        works when this page is open.
      </p>
    );
  }

  if (mode === "denied") {
    return (
      <div className="text-sm text-text-secondary" data-testid="notify-controls">
        <p data-testid="notify-permission-denied">
          Notifications are blocked for this site. The in-page banner still works
          while this page is open.
        </p>
      </div>
    );
  }

  if (mode === "compact-enabled") {
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
        data-testid="notify-controls"
      >
        <p className="font-medium text-foreground" data-testid="notify-enabled-copy">
          Notifications on
        </p>
        <label className="inline-flex items-center gap-1.5 text-text-secondary">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSoundOn(e.target.checked)}
            data-testid="notify-sound"
          />
          Sound
        </label>
        <label className="inline-flex items-center gap-1.5 text-text-secondary">
          <input
            type="checkbox"
            checked={vibrate}
            onChange={(e) => setVibrateOn(e.target.checked)}
            data-testid="notify-vibrate"
          />
          Vibrate
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="notify-disable"
          onClick={() => setNotificationsOn(false)}
        >
          Turn off
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
      data-testid="notify-controls"
    >
      <p className="text-sm text-text-secondary">
        Get a notification when you’re near the front — the in-page banner still works if you decline.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="notify-enable"
        className="border-border-strong bg-card text-foreground hover:bg-muted"
        onClick={() => void requestEnable()}
      >
        Enable notifications
      </Button>
    </div>
  );
}
