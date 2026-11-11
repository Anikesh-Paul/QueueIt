/**
 * Honest "now serving" labels.
 * A counter's nowServing is only live while someone has status serving there.
 * lastServed is the last completed serve, shown when the counter is free.
 */

export function presentCounterServing(counter = {}) {
  const live = Number.isInteger(counter.nowServing) ? counter.nowServing : null;
  const last = Number.isInteger(counter.lastServed) ? counter.lastServed : null;
  if (live != null) {
    return { label: "Now serving", value: String(live), live: true, last };
  }
  if (last != null) {
    return { label: "Last served", value: String(last), live: false, last };
  }
  return { label: "Now serving", value: "—", live: false, last: null };
}

export function presentServingBoard(counters = [], fallbackNowServing = null) {
  const list =
    Array.isArray(counters) && counters.length > 0
      ? counters
      : [{ nowServing: null, lastServed: fallbackNowServing }];
  const rows = list.map((counter) => ({
    ...presentCounterServing(counter),
    id: counter.id || counter.name || "default",
    name: counter.name || "",
  }));
  const anyLive = rows.some((row) => row.live);
  const anyLast = rows.some((row) => row.last != null);
  return {
    label: anyLive || !anyLast ? "Now serving" : "Last served",
    rows,
    multi: rows.length > 1,
    value: rows[0]?.value ?? "—",
  };
}
