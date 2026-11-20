/**
 * Public now-serving board payload. Token numbers only — no student names or emails.
 */
import { countersForJson } from "./counters.js";
import { partySizeOf } from "./partySize.js";

/**
 * @param {import("mongoose").Document} queue
 * @param {number} [waitingCount=0]
 */
export function toBoardJSON(queue, waitingCount = 0, { serving = [] } = {}) {
  // Party size of each called ticket (a number only, still nothing personal).
  const partyByToken = new Map((serving || []).map((row) => [Number(row.tokenNumber), partySizeOf(row)]));
  const publicQueue = typeof queue.toPublicJSON === "function" ? queue.toPublicJSON() : queue;
  const venue = publicQueue.venue
    ? { id: publicQueue.venue.id, name: publicQueue.venue.name, organizationId: publicQueue.venue.organizationId ?? null }
    : null;
  return {
    id: publicQueue.id,
    name: publicQueue.name,
    venue,
    status: publicQueue.status,
    acceptingTokens: publicQueue.acceptingTokens !== false,
    guestJoin: publicQueue.guestJoin !== false,
    waitingCount: Number(waitingCount) || 0,
    counters: countersForJson(queue).map((counter) => ({
      ...counter,
      nowServingPartySize: counter.nowServing != null ? partyByToken.get(Number(counter.nowServing)) ?? 1 : null,
    })),
  };
}
