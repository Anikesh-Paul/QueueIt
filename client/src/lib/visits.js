/** Helpers for the My visits page and starred queues. Pure, so they are unit-tested. */

export const VISITS_PAGE_SIZE = 10;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Starred queues first (in the order they were starred), the rest keep catalog order. */
export function sortWithFavorites(queues, favoriteIds) {
  const list = Array.isArray(queues) ? queues : [];
  const favs = Array.isArray(favoriteIds) ? favoriteIds.map(String) : [];
  if (!favs.length) return list;
  const rank = new Map(favs.map((id, i) => [id, i]));
  const starred = list.filter((q) => rank.has(String(q.id))).sort((a, b) => rank.get(String(a.id)) - rank.get(String(b.id)));
  const rest = list.filter((q) => !rank.has(String(q.id)));
  return [...starred, ...rest];
}

/** Clean filter state from URL search params (bad values are dropped, not sent). */
export function readVisitFilters(searchParams) {
  const get = (k) => (searchParams?.get?.(k) || "").trim();
  const queue = /^[a-fA-F0-9]{24}$/.test(get("queue")) ? get("queue") : "";
  const from = DAY_RE.test(get("from")) ? get("from") : "";
  const to = DAY_RE.test(get("to")) ? get("to") : "";
  const pageRaw = Number(get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return { queue, from, to, page };
}

/** Search params for the page URL and the API call. Empty values are left out. */
export function visitFilterParams({ queue = "", from = "", to = "", page = 1 } = {}, { pageSize } = {}) {
  const params = new URLSearchParams();
  if (queue) params.set("queue", queue);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (page && page > 1) params.set("page", String(page));
  if (pageSize) params.set("pageSize", String(pageSize));
  return params;
}

/** Is the date range backwards? */
export function rangeError({ from, to } = {}) {
  return Boolean(from && to && to < from);
}

export function hasActiveFilters({ queue, from, to } = {}) {
  return Boolean(queue || from || to);
}

/** i18n key for a visit outcome. */
export function outcomeKey(outcome) {
  switch (outcome) {
    case "served":
      return "visits.outcome.served";
    case "no-show":
      return "visits.outcome.noShow";
    case "skipped":
      return "visits.outcome.skipped";
    case "left":
      return "visits.outcome.left";
    case "active":
      return "visits.outcome.active";
    default:
      return "visits.outcome.unknown";
  }
}

/** Badge tone classes for an outcome. */
export function outcomeTone(outcome) {
  switch (outcome) {
    case "served":
      return "bg-primary-muted text-success";
    case "no-show":
      return "bg-danger-soft text-danger-ink";
    case "skipped":
      return "bg-warning-soft text-warning-ink";
    case "active":
      return "bg-info-soft text-info-ink";
    default:
      return "bg-secondary text-text-secondary";
  }
}

/** "12 min" / "1 h 5 min" style wait; null when unknown. Uses i18n keys so numbers stay localized. */
export function formatWait(minutes, t) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return t("visits.waitUnderMinute");
  if (minutes < 60) return t("visits.waitMinutes", { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t("visits.waitHoursMinutes", { hours, minutes: rest }) : t("visits.waitHours", { hours });
}

/**
 * Compact page list for pagination: always first/last, current ±1, gaps as null.
 * pageList(5, 10) → [1, null, 4, 5, 6, null, 10]
 */
export function pageList(page, totalPages) {
  const total = Math.max(1, totalPages || 1);
  const current = Math.min(Math.max(1, page || 1), total);
  const wanted = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null);
    out.push(sorted[i]);
  }
  return out;
}

/** Shape a visit so the shared rating helpers can read it. */
export function visitAsRateable(visit) {
  return { status: visit?.status, feedback: visit?.feedback || null, updatedAt: visit?.endedAt || visit?.joinedAt };
}
