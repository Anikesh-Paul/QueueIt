import { Wordmark } from "@/components/brand/wordmark";
import { MotifIllustration } from "@/components/brand/motif-illustration";

/**
 * Auth surfaces: motif | form from md (~768); form-only on phone.
 * Form card stays plain — motif column carries luxury (atmosphere B).
 * Motif is decorative; UI works if the image fails to load.
 */
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-card md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <aside
          className="relative hidden min-h-[22rem] flex-col justify-end overflow-hidden border-r border-primary-muted bg-secondary md:flex"
          data-testid="auth-motif-column"
        >
          <MotifIllustration
            motif="serviceWindow"
            variant="auth"
            className="absolute inset-0 z-0"
          />
          {/* Soft mist so headline stays legible over the illustration */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-2/5 bg-gradient-to-t from-secondary via-secondary/85 to-transparent"
          />
          <div className="relative z-10 p-8 pt-16">
            <p className="font-display text-display font-semibold leading-snug tracking-[-0.01em] text-foreground">
              Join the line from anywhere.
            </p>
          </div>
        </aside>

        <div className="flex flex-col justify-center gap-8 p-6 sm:p-10">
          <Wordmark to="/login" className="self-start" />
          {children}
        </div>
      </div>
    </div>
  );
}
