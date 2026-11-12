/** Ratings close this long after a visit (matches the server). */
export const FEEDBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const COMMENT_MAX = 500;
const DISMISSED_KEY = "queueit_feedback_dismissed";

/** Can this history row still be rated? */
export function canRateVisit(event, nowMs = Date.now()) {
  if (!event || event.status !== "served" || event.feedback) return false;
  const at = Date.parse(event.updatedAt || "");
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= FEEDBACK_WINDOW_MS;
}

export function readDismissed() {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
    return Array.isArray(list) ? list.filter((id) => typeof id === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

export function writeDismissed(list) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // Storage blocked — the prompt just comes back next visit.
  }
}

/** First pending visit the person hasn't waved away. */
export function nextPrompt(pending, dismissed) {
  const skip = new Set(dismissed || []);
  return (pending || []).find((row) => row?.entryId && !skip.has(row.entryId)) || null;
}

export function ratingWordKey(rating) {
  return rating >= 1 && rating <= 5 ? `feedback.rating${rating}` : null;
}
