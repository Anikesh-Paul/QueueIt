/**
 * Per-queue counters. A queue always has at least one.
 * `queue.nowServing` stays the most recently called or served token
 * (backward compatible); each counter also keeps its own nowServing.
 */

export const DEFAULT_COUNTER_NAME = "Counter 1";
export const COUNTER_NAME_MAX = 40;
export const COUNTER_NAME_MIN = 1;

export function normalizeCounterName(raw, fallback = DEFAULT_COUNTER_NAME) {
  if (typeof raw !== "string") return fallback;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < COUNTER_NAME_MIN) return fallback;
  return name.slice(0, COUNTER_NAME_MAX);
}

/** Ensure the queue document has at least one counter. Returns true if mutated. */
export function ensureDefaultCounters(queue) {
  if (!queue) return false;
  if (Array.isArray(queue.counters) && queue.counters.length > 0) return false;
  queue.counters = [
    {
      name: DEFAULT_COUNTER_NAME,
      nowServing: queue.nowServing ?? null,
    },
  ];
  return true;
}

export function countersForJson(queue) {
  const list = Array.isArray(queue?.counters) ? queue.counters : [];
  if (list.length === 0) {
    return [
      {
        id: null,
        name: DEFAULT_COUNTER_NAME,
        nowServing: queue?.nowServing ?? null,
      },
    ];
  }
  return list.map((counter) => ({
    id: counter._id?.toString?.() ?? String(counter._id || ""),
    name: counter.name || DEFAULT_COUNTER_NAME,
    nowServing: counter.nowServing ?? null,
  }));
}

export function findCounter(queue, counterId) {
  if (!queue || !Array.isArray(queue.counters)) return null;
  if (!counterId) return null;
  const id = String(counterId);
  return queue.counters.find((counter) => counter._id?.toString?.() === id) || null;
}

export function counterNameOf(queue, counterId) {
  const counter = findCounter(queue, counterId);
  return counter?.name || null;
}

/**
 * Pick a counter for call/serve.
 * @returns {{ ok: true, counter: object } | { ok: false, status: number, error: string }}
 */
export function resolveTargetCounter(queue, { counterId, busyIds } = {}) {
  ensureDefaultCounters(queue);
  const busy = busyIds instanceof Set ? busyIds : new Set(busyIds || []);
  if (counterId) {
    const counter = findCounter(queue, counterId);
    if (!counter) {
      return { ok: false, status: 404, error: "Counter not found" };
    }
    return { ok: true, counter };
  }
  const free = queue.counters.find((counter) => !busy.has(counter._id.toString()));
  if (free) return { ok: true, counter: free };
  const onlyOne = queue.counters.length <= 1;
  return {
    ok: false,
    status: 409,
    error: onlyOne
      ? "Someone is already being called. Serve or skip them first."
      : "All counters are busy. Serve or skip a called person first.",
  };
}

export function setCounterNowServing(queue, counter, tokenNumber) {
  if (counter) counter.nowServing = tokenNumber ?? null;
  queue.nowServing = tokenNumber ?? null;
}

export function clearAllCounterNowServing(queue) {
  if (!Array.isArray(queue.counters)) return;
  for (const counter of queue.counters) {
    counter.nowServing = null;
  }
}
