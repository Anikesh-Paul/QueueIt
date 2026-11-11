/**
 * Student-facing occupancy for catalog and join cards.
 * Always shown. Never use a current/cap fraction — “3/1 waiting” looks
 * broken when occupancy is already above the cap (or just reads as a score).
 */
export function formatWaitingOccupancy({ waitingCount, maxWaiting } = {}) {
  const count = Number(waitingCount);
  const n = Number.isFinite(count) && count >= 0 ? count : 0;
  const waiting = n === 0 ? "No one waiting" : `${n} waiting`;
  if (!Number.isInteger(maxWaiting) || maxWaiting < 1) return waiting;
  return `${waiting} · cap ${maxWaiting}`;
}
