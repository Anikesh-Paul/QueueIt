import { CheckCircle2 } from "lucide-react";
import { QueueItMark, Wordmark } from "@/components/brand/wordmark";
import { AUTH_MOTIF_LINE } from "@/lib/auth-copy";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useI18n } from "@/context/i18n-context";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";

/**
 * Sign-in surfaces (login, register, forgot, reset): one quiet centred column.
 * Wordmark and toggles on top, the form in a single card, a one-line footer.
 * From sm up the form sits on a raised card; on phones the card frame drops
 * away and the form runs edge to edge. A faint Forest halo and linen grain are
 * the only decoration. The entrance settle stops under reduced motion.
 */
export { AUTH_MOTIF_LINE };

export function AuthLayout({ children }) {
  const { t } = useI18n();
  return (
    <div className="auth-canvas relative flex min-h-dvh flex-col" data-testid="auth-layout">
      <SkipToContent />
      <div aria-hidden="true" className="auth-halo pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="auth-grain pointer-events-none absolute inset-0" />

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8 sm:py-6">
        <Wordmark to="/" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="relative flex flex-1 items-start justify-center px-5 pt-4 pb-10 outline-none sm:items-center sm:px-8 sm:pt-0 sm:pb-16"
      >
        <div
          data-testid="auth-card"
          className="auth-settle w-full max-w-[26rem] sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:px-10 sm:pt-10 sm:pb-9 sm:shadow-lift"
        >
          <span
            aria-hidden="true"
            className="mb-6 hidden size-11 place-items-center sm:grid rounded-xl bg-primary text-primary-foreground shadow-card"
          >
            <QueueItMark className="size-6" />
          </span>
          {children}
        </div>
      </main>

      <footer
        data-testid="auth-footer"
        className="relative px-5 pb-6 text-center text-xs leading-relaxed text-text-secondary sm:px-8"
      >
        {t("auth.brandFootnote")}
      </footer>
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
