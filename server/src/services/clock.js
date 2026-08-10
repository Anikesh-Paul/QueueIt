/**
 * Controllable campus/wall clock for session auto-close and window bind tests.
 * Production uses real wall time; HTTP tests freeze/advance via setNow.
 */

/** @type {Date | null} */
let frozenNow = null;

/** Current instant (frozen when tests call setNow). */
export function now() {
  return frozenNow ? new Date(frozenNow.getTime()) : new Date();
}

/**
 * Freeze the clock at an absolute instant (Date or ISO string).
 * @param {Date | string | number} instant
 */
export function setNow(instant) {
  frozenNow = new Date(instant);
  if (Number.isNaN(frozenNow.getTime())) {
    throw new Error("setNow requires a valid date");
  }
}

/** Clear freeze so now() follows wall clock again. */
export function resetClock() {
  frozenNow = null;
}

/**
 * Advance a frozen clock by milliseconds. No-op if not frozen (throws).
 * @param {number} ms
 */
export function advanceMs(ms) {
  if (!frozenNow) {
    throw new Error("advanceMs requires a frozen clock (call setNow first)");
  }
  frozenNow = new Date(frozenNow.getTime() + ms);
}
