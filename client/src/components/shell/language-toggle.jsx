import { Languages } from "lucide-react";
import { useI18n } from "@/context/i18n-context";
import { LOCALE_OPTIONS } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Language switcher: English, हिन्दी, বাংলা. Each language is listed in its
 * own script so people can find theirs. A native select keeps it compact in
 * the 390px header and works with any keyboard or screen reader. The choice
 * is remembered on this device; first visits follow the browser language.
 */
export function LanguageToggle({ className = "" } = {}) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label
      data-testid="language-toggle"
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-secondary pl-2 text-xs font-semibold text-foreground focus-within:ring-3 focus-within:ring-ring/50",
        className
      )}
      title={t("language.choose")}
    >
      <Languages className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        data-testid="language-select"
        className="h-full cursor-pointer appearance-none rounded-full bg-transparent pr-2.5 pl-0.5 text-xs font-semibold text-foreground outline-none"
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id} lang={option.id} data-testid={`language-${option.id}`}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
