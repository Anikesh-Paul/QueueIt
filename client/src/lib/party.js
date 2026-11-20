/** Group (party) tickets: one ticket for 1–4 people. */
export const PARTY_SIZE_MAX = 4;

/** People on a ticket; older tickets have none and count as 1. */
export function partySizeOf(row) {
  const n = Number(row?.partySize);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(PARTY_SIZE_MAX, n);
}

/** Queue group settings with safe defaults for older API responses. */
export function groupsOf(queue) {
  const g = queue?.groups;
  if (!g) return { enabled: false, maxSize: 1, extraPerPerson: 0.5 };
  const enabled = g.enabled !== false;
  const max = Number(g.maxSize);
  return {
    enabled,
    maxSize: enabled && Number.isInteger(max) ? Math.min(PARTY_SIZE_MAX, Math.max(1, max)) : 1,
    extraPerPerson: Number.isFinite(Number(g.extraPerPerson)) ? Number(g.extraPerPerson) : 0.5,
  };
}

/** Sizes a joiner may pick: [1..max]. Groups off → [1]. */
export function partyOptions(queue) {
  const { maxSize } = groupsOf(queue);
  return Array.from({ length: maxSize }, (_, i) => i + 1);
}

/** Clamp a picked size to what the queue allows now. */
export function clampPartySize(size, queue) {
  const { maxSize } = groupsOf(queue);
  const n = Number(size);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(maxSize, n);
}

/** Smaller sizes a waiting group may switch to. */
export function reduceOptions(partySize) {
  const n = partySizeOf({ partySize });
  return Array.from({ length: n - 1 }, (_, i) => i + 1);
}

/** Extra "serves" a group adds, as a percentage for admin copy (0.5 → 50). */
export function extraPercent(extraPerPerson) {
  const x = Number(extraPerPerson);
  return Number.isFinite(x) ? Math.round(x * 100) : 50;
}

/** Sum of people across rows (tickets with no size count as 1). */
export function peopleOn(rows = []) {
  return (rows || []).reduce((sum, row) => sum + partySizeOf(row), 0);
}
