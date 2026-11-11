/**
 * Student-facing occupancy next to a cap.
 * Never use a current/cap fraction — “3/1 waiting” looks broken when
 * occupancy is already above the cap (or just reads as a score).
 */
export function formatWaitingOccupancy({ waitingCount, maxWaiting } = {}) {
  if (!Number.isInteger(maxWaiting) || maxWaiting < 1) return "";
  const count = Number(waitingCount);
  const n = Number.isFinite(count) && count >= 0 ? count : 0;
  return `${n} waiting · cap ${maxWaiting}`;
}
