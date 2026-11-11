import { t } from "./i18n.js";

/**
 * Honest connection copy for the student status toolbar.
 * Offline (browser or last fetch from cache/failure) must never claim
 * Instant updates, Live, realtime, or “just now”.
 */

/** Quiet relative age for polling honesty (no absolute campus clocks here). */
export function formatStatusAge(updatedAt, nowMs, { offline = false, locale = "en" } = {}) {
  if (updatedAt == null) return null;
  const sec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (offline && sec < 5) return t(locale, "status.age.lastKnown");
  if (sec < 5) return t(locale, "status.age.justNow");
  if (sec < 60) return t(locale, "status.age.seconds", { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t(locale, "status.age.minutes", { n: min });
  return t(locale, "status.age.hours", { n: Math.floor(min / 60) });
}

/**
 * @param {{
 *   offline?: boolean,
 *   realtimeConnected?: boolean,
 *   statusLastUpdatedAt?: number|null,
 *   nowMs?: number,
 * }} input
 * @returns {{
 *   metaLabel: string,
 *   indicator: "realtime"|"polling"|"offline",
 *   ageLabel: string|null,
 *   showLiveBadge: boolean,
 * }}
 */
export function statusConnectionPresentation({
  offline = false,
  realtimeConnected = false,
  statusLastUpdatedAt = null,
  nowMs = Date.now(),
  locale = "en",
} = {}) {
  if (offline) {
    return {
      metaLabel: t(locale, "status.connection.offline"),
      indicator: "offline",
      ageLabel: formatStatusAge(statusLastUpdatedAt, nowMs, { offline: true, locale }),
      showLiveBadge: false,
    };
  }
  return {
    metaLabel: realtimeConnected
      ? t(locale, "status.connection.instant")
      : t(locale, "status.connection.polling"),
    indicator: realtimeConnected ? "realtime" : "polling",
    ageLabel: formatStatusAge(statusLastUpdatedAt, nowMs, { locale }),
    showLiveBadge: true,
  };
}
