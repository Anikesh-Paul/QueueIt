import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/context/i18n-context";

/**
 * Soft upgrade affordance — locked copy only.
 * {t("auth.keepHistory")} · {t("upgrade.body")}
 * Compact card (not a persistent full-width banner).
 */
export function SoftUpgradePrompt({ className, testId = "soft-upgrade-prompt", onNavigate }) {
  const { t } = useI18n();
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3 shadow-card",
        className
      )}
    >
      <p className="font-heading text-sm font-semibold text-foreground">{t("auth.keepHistory")}</p>
      <p className="mt-0.5 text-xs text-text-secondary">{t("upgrade.body")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" data-testid="soft-upgrade-register">
          <Link to="/register" onClick={onNavigate}>
            {t("auth.register")}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" data-testid="soft-upgrade-login">
          <Link to="/login" onClick={onNavigate}>
            {t("auth.login")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
