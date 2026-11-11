/**
 * Honest connection copy for the student status toolbar.
 * Offline (browser or last fetch from cache/failure) must never claim
 * Instant updates, Live, realtime, or “just now”.
 */

/** Quiet relative age for polling honesty (no absolute campus clocks here). */
export function formatStatusAge(updatedAt, nowMs, { offline = false } = {}) {
  if (updatedAt == null) return null;
  const sec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (offline && sec < 5) return "last known";
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
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
} = {}) {
  if (offline) {
    return {
      metaLabel: "Offline — last known place",
      indicator: "offline",
      ageLabel: formatStatusAge(statusLastUpdatedAt, nowMs, { offline: true }),
      showLiveBadge: false,
    };
  }
  return {
    metaLabel: realtimeConnected ? "Instant updates" : "Updates every few seconds",
    indicator: realtimeConnected ? "realtime" : "polling",
    ageLabel: formatStatusAge(statusLastUpdatedAt, nowMs),
    showLiveBadge: true,
  };
}
