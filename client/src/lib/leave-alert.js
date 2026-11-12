import { t } from "./i18n.js";

export const DEFAULT_TRAVEL_MINUTES = 10;
/** Travel choices offered on the status page (minutes). 0 = already nearby. */
export const TRAVEL_CHOICES = [0, 5, 10, 15, 20, 30, 45];

const LIVE_STATES = new Set(["later", "soon", "now"]);

/**
 * Re-derive the leave countdown against the wall clock between polls.
 * The server sends `leaveAt`; minutes left shrink as time passes, and the
 * state moves later → soon → now without waiting for the next poll.
 */
export function liveLeave(leave, nowMs = Date.now()) {
  if (!leave || !LIVE_STATES.has(leave.state) || !leave.leaveAt) return leave || null;
  const at = new Date(leave.leaveAt).getTime();
  if (!Number.isFinite(at)) return leave;
  const leaveInMinutes = Math.max(0, Math.ceil((at - nowMs) / 60_000));
  let state = "later";
  if (leaveInMinutes <= 0) state = "now";
  else if (leaveInMinutes <= 5) state = "soon";
  return { ...leave, state, leaveInMinutes };
}

/** Copy for the status card / banner. */
export function leaveCopy({ leave, etaMinutes, travelMinutes, clock, locale = "en" } = {}) {
  const state = leave?.state;
  if (state === "now") {
    return {
      title: t(locale, "leave.nowTitle"),
      body: t(locale, "leave.nowBody", {
        eta: Math.max(0, Math.round(etaMinutes ?? 0)),
        travel: travelMinutes ?? DEFAULT_TRAVEL_MINUTES,
      }),
    };
  }
  if (state === "soon") {
    return {
      title: t(locale, "leave.soonTitle"),
      body: t(locale, "leave.soonBody", { count: leave.leaveInMinutes, time: clock || "" }),
    };
  }
  if (state === "later") {
    return {
      title: t(locale, "leave.laterTitle", { time: clock || "" }),
      body: t(locale, "leave.laterBody", { count: leave.leaveInMinutes }),
    };
  }
  if (state === "paused") {
    return { title: t(locale, "leave.pausedTitle"), body: t(locale, "leave.pausedBody") };
  }
  return null;
}

/**
 * One system notification per token when it's time to leave. Position 1
 * already gets the "you're next" alert, so this only covers people further back.
 */
export function decideLeaveNotification({ leave, position, queueId, tokenNumber, lastKey = null } = {}) {
  if (!queueId || leave?.state !== "now" || !(Number.isInteger(position) && position > 1)) {
    return { fire: false, lastKey };
  }
  const key = `${queueId}:${tokenNumber ?? ""}:leave`;
  if (key === lastKey) return { fire: false, lastKey };
  return { fire: true, key, lastKey: key };
}

export function travelLabel(minutes, locale = "en") {
  if (minutes === 0) return t(locale, "leave.nearby");
  return t(locale, "leave.minutes", { count: minutes });
}
