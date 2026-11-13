import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/i18n-context";
import { UPDATE_EVENT, applyServiceWorkerUpdate, hasPendingUpdate } from "@/lib/register-sw";

/** "New version available" — shown once a new deploy's worker is installed and waiting. */
export function UpdatePrompt() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(() => hasPendingUpdate());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(UPDATE_EVENT, show);
    return () => window.removeEventListener(UPDATE_EVENT, show);
  }, []);

  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-prompt"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4"
    >
      <RefreshCw aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{t("update.title")}</p>
        <p className="text-text-secondary">{t("update.body")}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={() => setVisible(false)} data-testid="update-later">
          {t("update.later")}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            applyServiceWorkerUpdate();
          }}
          data-testid="update-refresh"
        >
          {t("update.refresh")}
        </Button>
      </div>
    </div>
  );
}
