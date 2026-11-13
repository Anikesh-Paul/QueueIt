import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/context/i18n-context";
import {
  INSTALL_AVAILABLE_EVENT,
  dismissInstall,
  hasDeferredInstallPrompt,
  isStandaloneDisplay,
  promptInstall,
  readInstallDismissedAt,
  shouldOfferInstall,
} from "@/lib/install-prompt";
import { UPDATE_EVENT, hasPendingUpdate } from "@/lib/register-sw";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentlyOffered() {
  return (
    !hasPendingUpdate() &&
    shouldOfferInstall({
      available: hasDeferredInstallPrompt(),
      standalone: isStandaloneDisplay(),
      dismissedAt: readInstallDismissedAt(storage()),
    })
  );
}

/** Small, dismissible "Install app" card for the student path (supported browsers only). */
export function InstallAppPrompt() {
  const { t } = useI18n();
  const [offered, setOffered] = useState(currentlyOffered);

  useEffect(() => {
    const sync = () => setOffered(currentlyOffered());
    window.addEventListener(INSTALL_AVAILABLE_EVENT, sync);
    window.addEventListener(UPDATE_EVENT, sync);
    return () => {
      window.removeEventListener(INSTALL_AVAILABLE_EVENT, sync);
      window.removeEventListener(UPDATE_EVENT, sync);
    };
  }, []);

  if (!offered) return null;

  function dismiss() {
    dismissInstall(storage());
    setOffered(false);
  }

  return (
    <aside
      aria-label={t("install.title")}
      data-testid="install-prompt"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-lg sm:inset-x-auto sm:left-4 sm:bottom-4"
    >
      <Download aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{t("install.title")}</p>
        <p className="text-text-secondary">{t("install.body")}</p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            data-testid="install-accept"
            onClick={async () => {
              const outcome = await promptInstall();
              if (outcome !== "accepted") dismissInstall(storage());
              setOffered(false);
            }}
          >
            {t("install.cta")}
          </Button>
          <Button variant="ghost" size="sm" onClick={dismiss} data-testid="install-dismiss">
            {t("install.dismiss")}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("install.dismiss")}
        className="-mr-1 rounded p-1 text-text-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </aside>
  );
}
