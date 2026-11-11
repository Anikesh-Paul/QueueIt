/** Local, in-page watch list for "notify me when this closed queue opens". */
export const OPEN_WATCH_KEY = "queueit_notify_open_queues";

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseOpenWatches(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function readOpenWatches() {
  try {
    return parseOpenWatches(localStorage.getItem(OPEN_WATCH_KEY));
  } catch {
    return [];
  }
}

export function writeOpenWatches(ids) {
  const next = parseOpenWatches(ids);
  try {
    if (next.length === 0) localStorage.removeItem(OPEN_WATCH_KEY);
    else localStorage.setItem(OPEN_WATCH_KEY, JSON.stringify(next));
  } catch {
    // Private mode / blocked storage — keep the in-memory list only.
  }
  return next;
}

/** Signup: add a queue id to the watch list. */
export function subscribeOpenWatch(ids, queueId) {
  const id = typeof queueId === "string" ? queueId.trim() : "";
  if (!id) return parseOpenWatches(ids);
  const current = parseOpenWatches(ids);
  if (current.includes(id)) return current;
  return [...current, id];
}

/** Cancel: remove a queue id from the watch list. */
export function cancelOpenWatch(ids, queueId) {
  const id = typeof queueId === "string" ? queueId.trim() : "";
  if (!id) return parseOpenWatches(ids);
  return parseOpenWatches(ids).filter((item) => item !== id);
}

export function isWatchingOpen(ids, queueId) {
  const id = typeof queueId === "string" ? queueId.trim() : "";
  return Boolean(id) && parseOpenWatches(ids).includes(id);
}

/**
 * Fire once when a watched queue starts accepting tokens.
 * Covers both staff stop-accepting and scheduled (not-yet-open) windows —
 * both flip `acceptingTokens` from false to true. Paused-but-accepting is
 * not a closed state and does not fire.
 *
 * After fire (or if the queue is already accepting when first observed),
 * the watch is cancelled so it cannot repeat.
 *
 * @param {{
 *   watching?: boolean,
 *   previousAccepting?: boolean | null,
 *   acceptingTokens?: boolean,
 * }} input
 */
export function decideOpenNotification({
  watching = false,
  previousAccepting = null,
  acceptingTokens = true,
} = {}) {
  if (!watching) {
    return {
      fire: false,
      watching: false,
      previousAccepting: acceptingTokens === true,
    };
  }
  if (acceptingTokens === true) {
    return {
      fire: previousAccepting !== true,
      watching: false,
      previousAccepting: true,
    };
  }
  return { fire: false, watching: true, previousAccepting: false };
}

export function openNotificationCopy({ queueName } = {}) {
  const queue = queueName || "Queue";
  return {
    title: `${queue} is accepting tokens`,
    body: `You can join ${queue} now.`,
  };
}
