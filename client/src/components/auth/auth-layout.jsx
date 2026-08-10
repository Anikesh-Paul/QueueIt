import { Wordmark } from "@/components/brand/wordmark";
import { MotifIllustration } from "@/components/brand/motif-illustration";

/** Motif headline — closed auth copy exception (craft + utility). */
export const AUTH_MOTIF_LINE = "Your place in line — without the hallway.";

/**
 * Auth surfaces: elevated card on warm canvas.
 * Desktop (md+): motif | form. Phone: compact motif band above form.
 * Atmosphere lives in motif + type + whisper material; form stays job-first.
 * Motif is decorative; UI works if the image fails to load.
 */
export function AuthLayout({ children }) {
  return (
    <div className="auth-canvas relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 sm:px-6 sm:py-14">
      {/* Soft vignette — material whisper, not a filter look */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,transparent_0%,rgb(26_26_24/0.04)_70%,rgb(26_26_24/0.07)_100%)]"
      />
      <div
        aria-hidden="true"
        className="auth-grain pointer-events-none absolute inset-0"
      />

      <div className="auth-settle relative w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-lift">
        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Desktop motif column */}
          <aside
            className="relative hidden min-h-[26rem] flex-col justify-end overflow-hidden border-r border-primary-muted bg-secondary md:flex"
            data-testid="auth-motif-column"
          >
            <MotifIllustration
              motif="serviceWindow"
              variant="auth"
              className="absolute inset-0 z-0 scale-[1.06] object-[center_40%]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-1/2 bg-gradient-to-t from-secondary via-secondary/90 to-transparent"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent"
            />
            <div className="relative z-10 p-9 pt-20 lg:p-10">
              <p className="max-w-[16ch] font-display text-[1.875rem] font-semibold leading-[1.2] tracking-[-0.015em] text-foreground">
                {AUTH_MOTIF_LINE}
              </p>
            </div>
          </aside>

          {/* Phone motif band — compact story without burying the form */}
          <div
            className="relative h-36 overflow-hidden border-b border-primary-muted bg-secondary md:hidden"
            data-testid="auth-motif-band"
            aria-hidden="true"
          >
            <MotifIllustration
              motif="serviceWindow"
              variant="auth"
              className="absolute inset-0 z-0 scale-110 object-[center_35%]"
            />
            <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-secondary via-secondary/75 to-secondary/20" />
            <div className="relative z-10 flex h-full items-end p-5">
              <p className="max-w-[18ch] font-display text-headline font-semibold leading-snug tracking-[-0.01em] text-foreground">
                {AUTH_MOTIF_LINE}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-center gap-9 px-6 py-8 sm:px-10 sm:py-12 lg:px-12 lg:py-14">
            <Wordmark to="/login" className="self-start" />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
