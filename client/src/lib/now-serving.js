import { t } from "./i18n.js";

/**
 * Honest "now serving" labels.
 * A counter's nowServing is only live while someone has status serving there.
 * lastServed is the last completed serve, shown when the counter is free.
 */

export function presentCounterServing(counter = {}, locale = "en") {
  const live = Number.isInteger(counter.nowServing) ? counter.nowServing : null;
  const last = Number.isInteger(counter.lastServed) ? counter.lastServed : null;
  const nowLabel = t(locale, "serving.now");
  const lastLabel = t(locale, "serving.last");
  if (live != null) {
    return { label: nowLabel, value: String(live), live: true, last };
  }
  if (last != null) {
    return { label: lastLabel, value: String(last), live: false, last };
  }
  return { label: nowLabel, value: "—", live: false, last: null };
}

export function presentServingBoard(counters = [], fallbackNowServing = null, locale = "en") {
  const list =
    Array.isArray(counters) && counters.length > 0
      ? counters
      : [{ nowServing: null, lastServed: fallbackNowServing }];
  const rows = list.map((counter) => ({
    ...presentCounterServing(counter, locale),
    id: counter.id || counter.name || "default",
    name: counter.name || "",
  }));
  const anyLive = rows.some((row) => row.live);
  const anyLast = rows.some((row) => row.last != null);
  const nowLabel = t(locale, "serving.now");
  const lastLabel = t(locale, "serving.last");
  return {
    label: anyLive || !anyLast ? nowLabel : lastLabel,
    rows,
    multi: rows.length > 1,
    value: rows[0]?.value ?? "—",
  };
}

/**
 * Compact now-serving / last-served line for catalog and join cards.
 * Multi-counter queues name each counter; mixed live/idle rows keep their own labels.
 */
export function formatCatalogServing({ counters, nowServing, locale = "en" } = {}) {
  const board = presentServingBoard(counters, nowServing ?? null, locale);
  if (!board.multi) {
    return `${board.label} ${board.value}`;
  }
  const nowLabel = t(locale, "serving.now");
  const parts = board.rows.map((row) => {
    const name = row.name ? `${row.name} ` : "";
    if (row.live === (board.label === nowLabel) || row.value === "—") {
      return `${name}${row.value}`.trim();
    }
    const label = locale === "hi" ? row.label : row.label.toLowerCase();
    return `${name}${label} ${row.value}`.trim();
  });
  return `${board.label} ${parts.join(", ")}`;
}
