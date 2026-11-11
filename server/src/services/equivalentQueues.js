export const EQUIVALENT_GROUP_MAX = 40;

export function normalizeEquivalentGroup(raw) {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim().replace(/\s+/g, " ");
  if (!value) return null;
  return value.slice(0, EQUIVALENT_GROUP_MAX);
}

export function equivalentGroupKey(raw) {
  const value = normalizeEquivalentGroup(raw);
  return value ? value.toLowerCase() : null;
}

export function isSuggestedJoinable(queue) {
  if (!queue) return false;
  if (queue.archived || queue.archivedAt) return false;
  if (queue.acceptingTokens === false) return false;
  if (queue.full === true) return false;
  const status = queue.status;
  if (status && status !== "open" && status !== "paused") return false;
  return true;
}

/**
 * Attach shorterEquivalent onto occupancy-enriched catalog cards.
 * Suggestion is informational only; it never moves a student automatically.
 */
export function attachEquivalentSuggestions(queues = []) {
  const cards = Array.isArray(queues) ? queues : [];
  return cards.map((queue) => {
    const group = equivalentGroupKey(queue.equivalentGroup);
    if (!group) return { ...queue, shorterEquivalent: null };
    const mine = Number(queue.waitingCount) || 0;
    const venueId = queue.venue?.id || queue.venue?._id?.toString?.() || queue.venue || null;
    const shorter = cards.filter((other) => {
      if (!other || other.id === queue.id) return false;
      if (equivalentGroupKey(other.equivalentGroup) !== group) return false;
      const otherVenue = other.venue?.id || other.venue?._id?.toString?.() || other.venue || null;
      if (venueId && otherVenue && String(venueId) !== String(otherVenue)) return false;
      if (!isSuggestedJoinable(other)) return false;
      return (Number(other.waitingCount) || 0) < mine;
    });
    if (shorter.length === 0) return { ...queue, shorterEquivalent: null };
    shorter.sort((a, b) => {
      const da = (Number(a.waitingCount) || 0) - (Number(b.waitingCount) || 0);
      if (da !== 0) return da;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    const best = shorter[0];
    return {
      ...queue,
      shorterEquivalent: {
        id: best.id,
        name: best.name,
        waitingCount: Number(best.waitingCount) || 0,
      },
    };
  });
}
