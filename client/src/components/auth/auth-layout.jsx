import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { AUTH_MOTIF_LINE } from "@/lib/auth-copy";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useI18n } from "@/context/i18n-context";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";
import { fetchStatusBoard } from "@/api";
import { landingStripItems } from "@/lib/landing";

/**
 * Sign-in surfaces (login, register, forgot, reset).
 * The landing's campus scene fills the page; the form floats on a card over it.
 * Desktop: headline + live waits on the left of the scene, card on the right.
 * Phone: the scene is a banner with the headline; the card slides up over its
 * bottom edge. The slow drift on the art stops under reduced motion.
 */
export { AUTH_MOTIF_LINE };

/** Up to two open lines with their current wait, from the public board. */
function useLiveWaits() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchStatusBoard()
      .then((data) => {
        if (!cancelled) setItems(landingStripItems(data?.queues).filter((q) => q.state === "open").slice(0, 2));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return items;
}

function LiveWaits() {
  const { t } = useI18n();
  const items = useLiveWaits();
  if (items.length === 0) return null;
  return (
    <ul className="mt-6 flex flex-wrap gap-2" data-testid="auth-live">
      {items.map((q) => (
        <li
          key={q.id}
          className="inline-flex items-center gap-2 rounded-full bg-[#fffcf7]/95 py-1.5 pr-3.5 pl-2.5 text-sm text-[#1a1a18] shadow-lift"
        >
          <span className="landing-live-dot size-2 rounded-full bg-[#2d6a4f]" aria-hidden="true" />
          <span className="font-semibold">{q.name}</span>
          <span className="text-[#57534e]">
            {q.minutes == null
              ? t("landing.liveNoEstimate")
              : q.minutes === 0
                ? t("landing.liveNoWait")
                : `${q.minutes} ${t("landing.liveMinutes")}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AuthLayout({ children }) {
  const { t } = useI18n();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#133227]" data-testid="auth-layout">
      <SkipToContent />

      {/* The scene: a banner on phones, the whole backdrop from lg up. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[min(27rem,56vh)] overflow-hidden lg:inset-0 lg:h-auto">
        <img
          src="/landing/hero.webp"
          srcSet="/landing/hero-800.webp 800w, /landing/hero.webp 1600w"
          sizes="100vw"
          width="1600"
          height="900"
          alt=""
          fetchPriority="high"
          data-testid="auth-scene"
          className="auth-scene size-full object-cover object-[62%_50%]"
        />
        <div className="auth-scene-shade absolute inset-0" />
      </div>

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8 sm:py-6">
        <Wordmark to="/" tone="inverse" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center lg:gap-16 lg:px-8 lg:pb-12">
        {/* Headline over the scene */}
        <section
          aria-label={t("auth.brandLabel")}
          data-testid="auth-story"
          className="px-5 pt-6 pb-14 sm:px-8 lg:px-0 lg:pt-0 lg:pb-0"
        >
          <p className="text-xs font-semibold tracking-[0.14em] text-[#d8f3dc] uppercase">{t("auth.brandEyebrow")}</p>
          <p className="mt-3 max-w-[18ch] font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.02em] text-balance text-[#fffcf7] sm:text-[2.5rem] lg:text-[3.25rem]">
            {t("auth.motif")}
          </p>
          <LiveWaits />
        </section>

        {/* The form */}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="relative -mt-6 flex flex-1 flex-col overflow-hidden rounded-t-[1.75rem] bg-card px-5 pt-8 pb-6 shadow-dialog outline-none sm:px-8 lg:mt-0 lg:flex-none lg:rounded-[1.75rem] lg:px-10 lg:pt-10 lg:pb-7 lg:shadow-[0_32px_80px_-24px_rgb(6_20_14/0.7),0_0_0_1px_rgb(255_252_247/0.14)]"
        >
          <span aria-hidden="true" className="auth-card-accent pointer-events-none absolute inset-x-0 top-0 h-1" />
          <div data-testid="auth-card" className="auth-settle mx-auto w-full max-w-[26rem] lg:max-w-none">
            {children}
          </div>
          <p
            data-testid="auth-footer"
            className="mx-auto mt-auto w-full max-w-[26rem] pt-5 text-center text-xs text-text-muted lg:max-w-none"
          >
            {t("auth.brandFootnote")}
          </p>
        </main>
      </div>
    </div>
  );
}

/** Small success panel (e.g. "Check your inbox"). */
export function AuthSuccess({ title, body, testId }) {
  return (
    <div className="auth-reveal mt-8 flex items-start gap-3 rounded-lg border border-primary/25 bg-primary-muted/50 px-4 py-4" data-testid={testId} role="status">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{body}</p>
      </div>
    </div>
  );
}
