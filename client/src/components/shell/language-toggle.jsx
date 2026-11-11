import { useI18n } from "@/context/i18n-context";
import { cn } from "@/lib/utils";

/**
 * Student language toggle. English remains the default; the choice persists
 * on this device. Compact enough for a 390-wide header.
 */
export function LanguageToggle({ className = "" } = {}) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("language.label")}
      data-testid="language-toggle"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-border bg-secondary p-0.5 text-xs font-semibold",
        className
      )}
    >
      {[
        { id: "en", label: "EN", name: t("language.en") },
        { id: "hi", label: "हिं", name: t("language.hi") },
      ].map((option) => {
        const selected = locale === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`language-${option.id}`}
            aria-pressed={selected}
            aria-label={option.name}
            onClick={() => setLocale(option.id)}
            className={cn(
              "rounded-full px-2 py-0.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "bg-card text-foreground shadow-card" : "text-text-secondary hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
