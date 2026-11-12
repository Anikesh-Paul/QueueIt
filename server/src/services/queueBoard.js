/**
 * Public now-serving board payload. Token numbers only — no student names or emails.
 */
import { countersForJson } from "./counters.js";

/**
 * @param {import("mongoose").Document} queue
 * @param {number} [waitingCount=0]
 */
export function toBoardJSON(queue, waitingCount = 0) {
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
    counters: countersForJson(queue),
  };
}
