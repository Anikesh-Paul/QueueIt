/**
 * Per-queue counters. A queue always has at least one.
 * `queue.nowServing` stays the most recently called or served token
 * (backward compatible). Each counter's `nowServing` is only the live
 * called token; `lastServed` is the last completed serve at that counter.
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
      nowServing: null,
      lastServed: queue.nowServing ?? null,
      lastAssignedAt: null,
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
        nowServing: null,
        lastServed: queue?.nowServing ?? null,
      },
    ];
  }
  return list.map((counter) => ({
    id: counter._id?.toString?.() ?? String(counter._id || ""),
    name: counter.name || DEFAULT_COUNTER_NAME,
    nowServing: counter.nowServing ?? null,
    lastServed: counter.lastServed ?? null,
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
function assignedAtMs(counter) {
  if (!counter?.lastAssignedAt) return 0;
  const time = new Date(counter.lastAssignedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

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
  const free = queue.counters.filter((counter) => !busy.has(counter._id.toString()));
  if (free.length > 0) {
    free.sort((a, b) => assignedAtMs(a) - assignedAtMs(b));
    return { ok: true, counter: free[0] };
  }
  const onlyOne = queue.counters.length <= 1;
  return {
    ok: false,
    status: 409,
    error: onlyOne
      ? "Someone is already being called. Serve or skip them first."
      : "All counters are busy. Serve or skip a called person first.",
  };
}

export function setCounterNowServing(queue, counter, tokenNumber, at = null) {
  if (counter) {
    counter.nowServing = tokenNumber ?? null;
    if (at) counter.lastAssignedAt = at;
  }
  if (tokenNumber != null) queue.nowServing = tokenNumber;
}

/**
 * A serve or skip finished at this counter: it is free again.
 * Served tokens become lastServed. queue.nowServing keeps the token for compatibility.
 */
export function completeCounterTurn(queue, counter, tokenNumber, { served = false } = {}) {
  if (tokenNumber != null) queue.nowServing = tokenNumber;
  if (!counter) return;
  if (served && tokenNumber != null) counter.lastServed = tokenNumber;
  counter.nowServing = null;
}

export function clearAllCounterNowServing(queue) {
  if (!Array.isArray(queue.counters)) return;
  for (const counter of queue.counters) {
    counter.nowServing = null;
    counter.lastServed = null;
  }
}

/**
 * Move a stored nowServing onto lastServed when no one is actually being
 * called at that counter (legacy rows and missed writes).
 * @returns {boolean} whether the queue document was mutated
 */
export function reconcileCounterServing(queue, servingEntries = []) {
  if (!queue) return false;
  ensureDefaultCounters(queue);
  const liveByCounter = new Map();
  for (const entry of servingEntries) {
    if (entry?.status && entry.status !== "serving") continue;
    const id = entry?.servingCounterId?.toString?.();
    const token = Number(entry?.tokenNumber);
    if (id && Number.isInteger(token)) liveByCounter.set(id, token);
  }
  let mutated = false;
  for (const counter of queue.counters) {
    const id = counter._id?.toString?.();
    const live = id ? liveByCounter.get(id) : undefined;
    if (live != null) {
      if (counter.nowServing !== live) {
        counter.nowServing = live;
        mutated = true;
      }
    } else if (counter.nowServing != null) {
      if (counter.lastServed == null) counter.lastServed = counter.nowServing;
      counter.nowServing = null;
      mutated = true;
    }
  }
  return mutated;
}
