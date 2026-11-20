/**
 * Group (party) tickets: one ticket for 1–4 people.
 *
 * Each extra person adds `extraPerPerson` of a normal serve to the wait
 * (0 = groups take no longer than one person, 1 = every person is a full serve).
 */
export const PARTY_SIZE_MAX = 4;
export const DEFAULT_GROUP_MAX = 4;
export const GROUP_MAX_MIN = 2;
export const DEFAULT_EXTRA_PER_PERSON = 0.5;

/** Party size on a stored entry; older tickets have none and count as one person. */
export function partySizeOf(entry) {
  const n = Number(entry?.partySize);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(PARTY_SIZE_MAX, n);
}

/** Effective group settings for a queue (defaults for older documents). */
export function groupSettingsOf(queue) {
  const enabled = queue?.groupTicketsEnabled !== false;
  const rawMax = Number(queue?.groupMaxSize);
  const maxSize = Number.isInteger(rawMax) && rawMax >= GROUP_MAX_MIN && rawMax <= PARTY_SIZE_MAX ? rawMax : DEFAULT_GROUP_MAX;
  const rawExtra = Number(queue?.groupExtraPerPerson);
  const extraPerPerson = Number.isFinite(rawExtra) && rawExtra >= 0 && rawExtra <= 1 ? rawExtra : DEFAULT_EXTRA_PER_PERSON;
  return { enabled, maxSize: enabled ? maxSize : 1, extraPerPerson };
}

export function groupsForJson(queue) {
  const { enabled, maxSize, extraPerPerson } = groupSettingsOf(queue);
  return { enabled, maxSize, extraPerPerson };
}

/**
 * Party size from a join (or walk-in) body. Missing means 1.
 * @returns {{ value: number } | { error: string, code: string }}
 */
export function cleanPartySize(raw, queue) {
  if (raw === undefined || raw === null || raw === "") return { value: 1 };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > PARTY_SIZE_MAX) {
    return { error: `Party size must be a whole number from 1 to ${PARTY_SIZE_MAX}`, code: "party-size-invalid" };
  }
  const { enabled, maxSize } = groupSettingsOf(queue);
  if (n > 1 && !enabled) {
    return { error: "This queue takes one person per ticket", code: "groups-disabled" };
  }
  if (n > maxSize) {
    return { error: `This queue allows up to ${maxSize} people per ticket`, code: "party-size-too-big" };
  }
  return { value: n };
}

/** How many "normal serves" a ticket for `partySize` people takes. */
export function serviceUnits(partySize, extraPerPerson = DEFAULT_EXTRA_PER_PERSON) {
  const n = Math.max(1, Number(partySize) || 1);
  return 1 + Math.max(0, Number(extraPerPerson) || 0) * (n - 1);
}

/**
 * Serve units up to and including `entry` in an already-ordered waiting list.
 * Falls back to `position` (one unit per ticket) when the entry isn't found.
 */
export function unitsThrough(ordered, entry, extraPerPerson, position = null) {
  const id = entry?._id?.toString?.() ?? entry?.id ?? null;
  const token = Number(entry?.tokenNumber);
  let units = 0;
  for (const row of ordered || []) {
    units += serviceUnits(partySizeOf(row), extraPerPerson);
    const match = (id && row._id?.toString?.() === id) || (!id && Number(row.tokenNumber) === token);
    if (match) return Math.round(units * 100) / 100;
  }
  return position;
}

/** Units for `count` tickets carrying `people` people in total. */
export function unitsForCounts(count, people, extraPerPerson = DEFAULT_EXTRA_PER_PERSON) {
  const tickets = Math.max(0, Number(count) || 0);
  const total = Math.max(tickets, Number(people) || 0);
  return tickets + Math.max(0, Number(extraPerPerson) || 0) * (total - tickets);
}

/**
 * Validate admin group settings in a create/update patch. Mutates `queue` on success.
 * @returns {{ error?: string }}
 */
export function applyGroupSettings(queue, patch = {}) {
  if (patch.groupTicketsEnabled !== undefined) {
    if (typeof patch.groupTicketsEnabled !== "boolean") return { error: "Group tickets must be true or false" };
    queue.groupTicketsEnabled = patch.groupTicketsEnabled;
  }
  if (patch.groupMaxSize !== undefined && patch.groupMaxSize !== null && patch.groupMaxSize !== "") {
    const n = Number(patch.groupMaxSize);
    if (!Number.isInteger(n) || n < GROUP_MAX_MIN || n > PARTY_SIZE_MAX) {
      return { error: `Largest group must be a whole number from ${GROUP_MAX_MIN} to ${PARTY_SIZE_MAX}` };
    }
    queue.groupMaxSize = n;
  }
  if (patch.groupExtraPerPerson !== undefined && patch.groupExtraPerPerson !== null && patch.groupExtraPerPerson !== "") {
    const x = Number(patch.groupExtraPerPerson);
    if (!Number.isFinite(x) || x < 0 || x > 1) {
      return { error: "Extra time per person must be between 0 and 1 (a fraction of one serve)" };
    }
    queue.groupExtraPerPerson = Math.round(x * 100) / 100;
  }
  return {};
}

/**
 * Lower the party size on a waiting ticket. Never raises it (that would
 * jump people already behind them).
 * @returns {{ ok: true, entry } | { ok: false, status: number, error: string, code?: string }}
 */
export async function reducePartySize(entry, raw) {
  if (!entry || entry.status !== "waiting") {
    return { ok: false, status: 409, error: "You can only change your group while waiting", code: "not-waiting" };
  }
  const n = Number(raw);
  const current = partySizeOf(entry);
  if (!Number.isInteger(n) || n < 1 || n > PARTY_SIZE_MAX) {
    return { ok: false, status: 400, error: `Party size must be a whole number from 1 to ${PARTY_SIZE_MAX}`, code: "party-size-invalid" };
  }
  if (n > current) {
    return { ok: false, status: 400, error: "You can only make your group smaller", code: "party-size-increase" };
  }
  if (n === current) return { ok: true, entry, changed: false };
  entry.partySize = n;
  await entry.save();
  return { ok: true, entry, changed: true };
}
