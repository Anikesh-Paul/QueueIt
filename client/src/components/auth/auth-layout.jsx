import { Wordmark } from "@/components/brand/wordmark";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { AUTH_MOTIF_LINE } from "@/lib/auth-copy";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";

/**
 * Auth surfaces: elevated card on a flat linen canvas.
 * Desktop (md+): hard-cropped motif | form. Phone: compact motif band above form.
 * No gradient washes. Motif is decorative; UI works if the image fails to load.
 */
export { AUTH_MOTIF_LINE };

export function AuthLayout({ children }) {
  return (
    <div className="auth-canvas relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6 sm:py-14">
      <SkipToContent />
      <div
        aria-hidden="true"
        className="auth-grain pointer-events-none absolute inset-0"
      />

      <div className="auth-settle relative w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-lift">
        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Desktop motif column — hard crop + solid linen copy panel */}
          <aside
            className="relative hidden min-h-[26rem] flex-col overflow-hidden border-r border-primary-muted bg-secondary md:flex"
            data-testid="auth-motif-column"
          >
            <div className="relative h-[18rem] shrink-0 overflow-hidden bg-secondary lg:h-[20rem]">
              <MotifIllustration
                motif="serviceWindow"
                variant="auth"
                className="h-full w-full object-cover object-[center_40%]"
              />
            </div>
            <div className="relative z-10 border-t border-primary-muted bg-secondary p-9 lg:p-10">
              <p className="max-w-[16ch] font-display text-[1.875rem] font-semibold leading-[1.2] tracking-[-0.015em] text-foreground">
                {AUTH_MOTIF_LINE}
              </p>
            </div>
          </aside>

          {/* Phone motif band — hard crop with a solid linen strip for the line */}
          <div
            className="relative overflow-hidden border-b border-primary-muted bg-secondary md:hidden"
            data-testid="auth-motif-band"
          >
            <div className="relative h-28 overflow-hidden bg-secondary" aria-hidden="true">
              <MotifIllustration
                motif="serviceWindow"
                variant="auth"
                className="absolute inset-0 z-0 h-full w-full object-cover object-[center_35%]"
              />
            </div>
            <div className="bg-secondary px-5 py-4">
              <p className="max-w-[18ch] font-display text-headline font-semibold leading-snug tracking-[-0.01em] text-foreground">
                {AUTH_MOTIF_LINE}
              </p>
            </div>
          </div>

          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex flex-col justify-center gap-9 px-6 py-8 outline-none sm:px-10 sm:py-12 lg:px-12 lg:py-14"
          >
            <Wordmark to="/login" className="self-start" />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
