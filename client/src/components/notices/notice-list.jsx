import { useState } from "react";
import { AlertOctagon, Clock3, Info, X } from "lucide-react";
import { useI18n } from "@/context/i18n-context";
import { dismissKey, readHidden, untilLabel, visibleNotices, writeHidden } from "@/lib/announcements";
import { cn } from "@/lib/utils";

const TONE = {
  info: { icon: Info, box: "border-border bg-card", ink: "text-foreground", icon_: "text-info-ink" },
  delay: { icon: Clock3, box: "border-warning-line bg-warning-soft", ink: "text-warning-ink", icon_: "text-warning-ink" },
  closure: { icon: AlertOctagon, box: "border-destructive/35 bg-danger-soft", ink: "text-danger-ink", icon_: "text-danger-ink" },
};

/**
 * Staff notices for the person waiting. Closures first. Each can be hidden on
 * this device; an edit by staff shows it again.
 */
export function NoticeList({ notices, showAudience = false, className, hideable = true, collapseAfter = 0 }) {
  const { t, locale } = useI18n();
  const [hidden, setHidden] = useState(readHidden);
  const [expanded, setExpanded] = useState(false);
  const all = hideable ? visibleNotices(notices, hidden) : visibleNotices(notices, []);
  if (!all.length) return null;
  const collapsed = collapseAfter > 0 && !expanded && all.length > collapseAfter;
  const shown = collapsed ? all.slice(0, collapseAfter) : all;

  function hide(notice) {
    const next = [...hidden, dismissKey(notice)];
    setHidden(next);
    writeHidden(next);
  }

  return (
    <section aria-label={t("notices.label")} className={cn("space-y-2", className)} data-testid="notice-list">
      {shown.map((n) => {
        const tone = TONE[n.tone] || TONE.info;
        const Icon = tone.icon;
        return (
          <article
            key={n.id}
            className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", tone.box)}
            data-testid="notice"
            data-tone={n.tone}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", tone.icon_)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={cn("font-heading text-sm font-semibold leading-5", tone.ink)}>
                <span className="sr-only">{t(`notices.tone.${n.tone}`)}: </span>
                {n.title}
              </p>
              {n.body ? <p className={cn("mt-0.5 text-sm leading-5", tone.ink, "opacity-90")}>{n.body}</p> : null}
              <p className="mt-1 text-xs text-text-muted">
                {showAudience && n.scope !== "campus" && n.audience ? `${n.audience} · ` : ""}
                {t("notices.until", { time: untilLabel(n.endsAt, undefined, locale) })}
              </p>
            </div>
            {hideable ? (
              <button
                type="button"
                onClick={() => hide(n)}
                className="-mr-1.5 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("notices.hide", { title: n.title })}
                data-testid="notice-hide"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </article>
        );
      })}
      {collapseAfter > 0 && all.length > collapseAfter ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="rounded-md px-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="notice-more"
        >
          {expanded ? t("notices.fewer") : t("notices.more", { count: all.length - collapseAfter })}
        </button>
      ) : null}
    </section>
  );
}
