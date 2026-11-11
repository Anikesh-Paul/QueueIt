import {
  MAIN_CONTENT_ID,
  SKIP_TO_CONTENT_HREF,
} from "@/lib/skip-to-content";
import { useI18n } from "@/context/i18n-context";

/**
 * First focusable control: visually hidden until focused, then jumps focus to
 * the page <main> without changing the route.
 */
export function SkipToContent() {
  const { t } = useI18n();
  function handleClick(event) {
    event.preventDefault();
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;
    main.focus();
  }

  return (
    <a
      href={SKIP_TO_CONTENT_HREF}
      onClick={handleClick}
      data-testid="skip-to-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-lift focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {t("skipToContent")}
    </a>
  );
}
