import { now as clockNow } from "./clock.js";

/** Travel time a person gets until they choose their own. */
export const DEFAULT_TRAVEL_MINUTES = 10;
export const MAX_TRAVEL_MINUTES = 120;
/** "Soon" starts this many minutes before the leave moment. */
export const LEAVE_SOON_MINUTES = 5;

/**
 * Validate a travel time from the client. Returns a whole number of minutes,
 * or null when the value is unusable.
 */
export function cleanTravelMinutes(raw) {
  if (raw === "" || raw == null || typeof raw === "boolean") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_TRAVEL_MINUTES) return null;
  return value;
}

export function travelMinutesOf(entry) {
  const stored = entry?.travelMinutes;
  return Number.isInteger(stored) && stored >= 0 ? stored : DEFAULT_TRAVEL_MINUTES;
}

/**
 * When should this person set off? Pure, so the status payload and tests
 * share one rule.
 *
 * - called:  already called to a counter; the called banner takes over.
 * - paused:  the line is not moving, so no countdown.
 * - now:     their turn is about as far away as their travel time.
 * - soon:    within LEAVE_SOON_MINUTES of that moment.
 * - later:   plenty of time.
 */
export function resolveLeave({ status, paused = false, etaMinutes, travelMinutes, at = clockNow() } = {}) {
  const travel = Number.isInteger(travelMinutes) ? travelMinutes : DEFAULT_TRAVEL_MINUTES;
  if (status === "serving") return { state: "called", leaveInMinutes: 0, leaveAt: null };
  if (status !== "waiting" || etaMinutes == null || !Number.isFinite(etaMinutes)) {
    return { state: "unknown", leaveInMinutes: null, leaveAt: null };
  }
  if (paused) return { state: "paused", leaveInMinutes: null, leaveAt: null };
  const leaveInMinutes = Math.max(0, Math.round(etaMinutes - travel));
  const leaveAt = new Date(at.getTime() + leaveInMinutes * 60_000).toISOString();
  let state = "later";
  if (leaveInMinutes <= 0) state = "now";
  else if (leaveInMinutes <= LEAVE_SOON_MINUTES) state = "soon";
  return { state, leaveInMinutes, leaveAt };
}

export function leaveFieldsForJson(entry, { etaMinutes, paused }) {
  const travelMinutes = travelMinutesOf(entry);
  return {
    travelMinutes,
    travelMinutesSet: Number.isInteger(entry?.travelMinutes),
    leave: resolveLeave({ status: entry?.status, paused, etaMinutes, travelMinutes }),
  };
}
