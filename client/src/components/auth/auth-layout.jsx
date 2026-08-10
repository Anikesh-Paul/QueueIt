import { Wordmark } from "@/components/brand/wordmark";

/**
 * Auth surfaces: centered surface card, optional decorative motif column on
 * >=768px. The motif slot is a placeholder until motif assets land (tickets
 * 19-22) — pure geometry, no fake product imagery.
 */
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-card shadow-card md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <aside className="relative hidden min-h-full flex-col justify-between overflow-hidden border-r border-primary-muted bg-secondary p-8 md:flex">
          <MotifMark />
          <div className="relative z-10">
            <p className="font-heading text-headline leading-snug text-foreground">
              Join the line from anywhere.
            </p>
            <p className="mt-2 max-w-xs text-sm text-text-secondary">
              Pick a queue, get a token, and keep the time you would have spent
              standing.
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

/** Quiet geometric placeholder for the auth illustration slot (O5 forest/mist). */
function MotifMark() {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden="true"
      className="absolute right-8 top-8 z-0 size-36 opacity-90"
    >
      <circle cx="40" cy="40" r="26" fill="#D8F3DC" />
      <circle cx="110" cy="34" r="14" fill="#F0FDF4" fillOpacity="0.7" />
      <rect x="64" y="88" width="52" height="34" rx="10" fill="#F0FDF4" />
      <rect x="70" y="94" width="40" height="6" rx="3" fill="#1B4332" />
      <rect x="70" y="106" width="24" height="6" rx="3" fill="#1B4332" fillOpacity="0.55" />
      <circle cx="40" cy="130" r="18" fill="#D8F3DC" fillOpacity="0.8" />
      <circle cx="122" cy="134" r="12" fill="#F0FDF4" fillOpacity="0.55" />
      <rect x="22" y="168" width="120" height="16" rx="8" fill="#F0FDF4" fillOpacity="0.9" />
    </svg>
  );
}