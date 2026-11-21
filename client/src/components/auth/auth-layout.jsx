import { CheckCircle2 } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { AUTH_MOTIF_LINE } from "@/lib/auth-copy";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useI18n } from "@/context/i18n-context";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";

/**
 * Sign-in surfaces (login, register, forgot, reset).
 * Desktop (lg+): forest brand panel with the value proposition and a small
 * animated queue, next to the form column. Phone/tablet: a compact forest
 * header above the form. Everything is local (no external fonts or images),
 * and the animation stops under prefers-reduced-motion.
 */
export { AUTH_MOTIF_LINE };

const POINTS = ["auth.brandPoint1", "auth.brandPoint2", "auth.brandPoint3"];

export function AuthLayout({ children }) {
  const { t } = useI18n();
  return (
    <div className="auth-canvas relative min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <SkipToContent />

      {/* Desktop brand panel */}
      <aside
        aria-label={t("auth.brandLabel")}
        data-testid="auth-brand-panel"
        className="auth-brand relative hidden min-h-dvh flex-col justify-between overflow-hidden px-12 py-10 lg:flex xl:px-16"
      >
        <div aria-hidden="true" className="auth-brand-glow pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="auth-grain pointer-events-none absolute inset-0" />
        <Wordmark to="/login" tone="inverse" className="relative self-start" />

        <div className="relative max-w-[30rem]">
          <p className="text-xs font-semibold tracking-[0.12em] text-[#b7e4c7] uppercase">{t("auth.brandEyebrow")}</p>
          <p className="mt-4 font-display text-[2.75rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[#f0fdf4] xl:text-[3.25rem]">
            {t("auth.motif")}
          </p>
          <ul className="mt-8 flex flex-col gap-3.5">
            {POINTS.map((key) => (
              <li key={key} className="flex items-start gap-3 text-[1.0625rem] leading-snug text-[#d8f3dc]">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#95d5b2]" aria-hidden="true" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>

        <QueueIllustration />
      </aside>

      {/* Form column */}
      <div className="relative flex min-h-dvh flex-col">
        {/* Phone/tablet brand header */}
        <header
          data-testid="auth-brand-header"
          className="auth-brand relative overflow-hidden px-5 pt-5 pb-6 sm:px-8 lg:hidden"
        >
          <div aria-hidden="true" className="auth-brand-glow pointer-events-none absolute inset-0" />
          <div className="relative flex items-center justify-between gap-3">
            <Wordmark to="/login" tone="inverse" />
            <MiniTickets />
          </div>
          <p className="relative mt-4 max-w-[22ch] font-display text-[1.5rem] font-semibold leading-[1.2] tracking-[-0.01em] text-[#f0fdf4] sm:max-w-none">
            {t("auth.motif")}
          </p>
        </header>

        <div className="flex items-center justify-end gap-2 px-5 pt-4 sm:px-8 lg:px-12 lg:pt-8">
          <ThemeToggle />
          <LanguageToggle />
        </div>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 justify-center px-5 pt-6 pb-10 outline-none sm:px-8 lg:items-center lg:px-12 lg:pt-0 lg:pb-16"
        >
          <div className="auth-settle w-full max-w-[25rem]">{children}</div>
        </main>

        <footer className="px-5 pb-6 text-center text-xs text-text-secondary sm:px-8 lg:px-12">
          {t("auth.footer")}
        </footer>
      </div>
    </div>
  );
}

/**
 * The landing's campus scene, framed on the forest panel so sign-in carries the
 * same look as "/". Decorative (aria-hidden); lazy so the form paints first.
 */
function QueueIllustration() {
  const { t } = useI18n();
  return (
    <div aria-hidden="true" className="relative mt-10 select-none" data-testid="auth-queue-illustration">
      <img
        src="/landing/hero-800.webp"
        width="800"
        height="450"
        alt=""
        loading="lazy"
        decoding="async"
        className="block aspect-[16/9] w-full max-w-[30rem] rounded-2xl border border-white/15 object-cover shadow-dialog"
      />
      <p className="mt-5 text-sm text-[#b7e4c7]">{t("auth.brandFootnote")}</p>
    </div>
  );
}

/** Three tiny tickets for the phone header. */
function MiniTickets() {
  return (
    <span aria-hidden="true" className="flex items-end gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={
            "auth-mini-ticket block h-7 w-5 rounded-md border " +
            (i === 0 ? "border-[#e7b06a]/80 bg-[#e7b06a]/25" : "border-white/25 bg-white/10")
          }
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/** Small success panel (e.g. "Check your inbox"). */
export function AuthSuccess({ title, body, testId }) {
  return (
    <div className="auth-reveal mt-8 flex items-start gap-3 rounded-lg border border-primary/25 bg-primary-muted/50 px-4 py-4" data-testid={testId} role="status">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">{body}</p>
      </div>
    </div>
  );
}
