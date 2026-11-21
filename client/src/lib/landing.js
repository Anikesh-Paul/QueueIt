/** How many live queues the landing strip shows. */
export const LANDING_STRIP_LIMIT = 4;

const STATE_ORDER = { open: 0, paused: 1, closed: 2 };

function queueState(queue) {
  if (queue?.acceptingTokens === false) return "closed";
  if (queue?.status === "paused") return "paused";
  return "open";
}

function waitMinutes(waitEstimate) {
  if (!waitEstimate) return null;
  if (waitEstimate.source === "empty") return 0;
  const high = Number(waitEstimate.high);
  if (!Number.isFinite(high)) return null;
  return Math.max(0, Math.round(high));
}

/**
 * Status-board queues → landing "live strip" cards: open lines first, then
 * paused, then closed (by name within each), capped at LANDING_STRIP_LIMIT.
 * `minutes` is the upper end of the wait range in whole minutes (0 = no wait,
 * null = no estimate yet).
 */
export function landingStripItems(queues) {
  if (!Array.isArray(queues)) return [];
  return queues
    .filter((q) => q && q.id && q.name)
    .map((q) => ({
      id: String(q.id),
      name: q.name,
      place: q.venue?.name || "",
      state: queueState(q),
      minutes: waitMinutes(q.waitEstimate),
      waiting: Math.max(0, Number(q.waitingCount) || 0),
    }))
    .sort(
      (a, b) =>
        STATE_ORDER[a.state] - STATE_ORDER[b.state] || String(a.name).localeCompare(String(b.name))
    )
    .slice(0, LANDING_STRIP_LIMIT);
}

/**
 * The value a counter shows `progress` (0..1) of the way through its tick-in:
 * an ease-out cubic, rounded, clamped to [0, target].
 */
export function tickValue(target, progress) {
  if (typeof target !== "number" || !Number.isFinite(target)) return null;
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  const eased = 1 - (1 - p) ** 3;
  return Math.round(target * eased);
}
