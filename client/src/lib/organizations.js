export const DEFAULT_ORG_ID = "default";
const STORAGE_KEY = "queueit_org";

/** Org id a queue belongs to (venues with no org are the main campus). */
export function orgIdOfQueue(queue) {
  return queue?.venue?.organizationId || DEFAULT_ORG_ID;
}

export function readOrgChoice() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function writeOrgChoice(slug) {
  try {
    if (slug) localStorage.setItem(STORAGE_KEY, slug);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the picker just resets next visit.
  }
}

/**
 * Which org to show: the ?org= link first, then the saved choice, then the
 * first org listed. Returns null when there's only one org (no picker).
 */
export function pickOrg(orgs, { linkSlug = "", savedSlug = "" } = {}) {
  if (!Array.isArray(orgs) || orgs.length < 2) return null;
  const bySlug = (slug) => (slug ? orgs.find((o) => o.slug === slug || o.id === slug) : null);
  return bySlug(linkSlug) || bySlug(savedSlug) || orgs[0];
}

export function queuesForOrg(queues, org) {
  if (!org) return queues || [];
  return (queues || []).filter((q) => orgIdOfQueue(q) === org.id);
}

/** Campus notices for every org, or for this org; venue/queue notices only for its lines. */
export function noticesForOrg(notices, org, queues) {
  if (!org) return notices || [];
  const queueIds = new Set((queues || []).map((q) => q.id));
  const venueIds = new Set((queues || []).map((q) => q.venue?.id).filter(Boolean));
  return (notices || []).filter((n) => {
    if (n.scope === "campus") return !n.organizationId || n.organizationId === org.id;
    if (n.scope === "venue") return venueIds.has(n.venueId);
    return queueIds.has(n.queueId);
  });
}

/** "Org · Venue" when there's more than one org, else just the venue. */
export function placeLabel(venueName, orgs, orgId) {
  if (!Array.isArray(orgs) || orgs.length < 2) return venueName || "";
  const org = orgs.find((o) => o.id === (orgId || DEFAULT_ORG_ID));
  return [org?.name, venueName].filter(Boolean).join(" · ");
}
