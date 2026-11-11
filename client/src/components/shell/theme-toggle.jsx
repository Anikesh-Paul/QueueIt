import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/context/theme-context";
import { useI18n } from "@/context/i18n-context";
import { cn } from "@/lib/utils";

/** Icon button that flips light / dark and remembers the choice on this device. */
export function ThemeToggle({ className = "" } = {}) {
  const { resolved, toggle } = useTheme();
  const { t } = useI18n();
  const dark = resolved === "dark";
  const label = dark ? t("theme.toLight") : t("theme.toDark");
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={dark}
      data-testid="theme-toggle"
      data-theme={resolved}
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center rounded-full border border-border bg-secondary text-text-secondary transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}
