import { t } from "./i18n.js";

/**
 * Student-facing occupancy for catalog and join cards.
 * Always shown. Never use a current/cap fraction — “3/1 waiting” looks
 * broken when occupancy is already above the cap (or just reads as a score).
 */
export function formatWaitingOccupancy({ waitingCount, maxWaiting, locale = "en" } = {}) {
  const count = Number(waitingCount);
  const n = Number.isFinite(count) && count >= 0 ? count : 0;
  const waiting = n === 0 ? t(locale, "occupancy.none") : t(locale, "occupancy.waiting", { count: n });
  if (!Number.isInteger(maxWaiting) || maxWaiting < 1) return waiting;
  return t(locale, "occupancy.cap", { waiting, cap: maxWaiting });
}
