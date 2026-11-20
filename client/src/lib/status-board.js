import { catalogWaitLabel, confidenceLabel } from "./wait-estimate.js";
import { formatAgo, livePollMs } from "./live-view.js";

export const STATUS_BOARD_PATH = "/status-board";
export const DEFAULT_BOARD_REFRESH_SECONDS = 15;

/** Shareable path for the public campus wait board. */
export function statusBoardPath({ org, venue } = {}) {
  const params = new URLSearchParams();
  const orgKey = typeof org === "string" ? org.trim() : "";
  const venueKey = typeof venue === "string" ? venue.trim() : "";
  if (orgKey) params.set("org", orgKey);
  if (venueKey) params.set("venue", venueKey);
  const qs = params.toString();
  return qs ? `${STATUS_BOARD_PATH}?${qs}` : STATUS_BOARD_PATH;
}

export function parseStatusBoardParams(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const org = String(params.get("org") || "").trim();
  const venue = String(params.get("venue") || "").trim();
  return { org: org || null, venue: venue || null };
}

export function statusBoardUrl(origin, filters) {
  if (typeof origin !== "string") return null;
  const base = origin.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}${statusBoardPath(filters)}`;
}

/**
 * Group queues by organization, then venue. Org headings are only needed
 * when more than one organization is present.
 */
export function groupStatusBoard(queues = []) {
  const orgs = new Map();
  for (const queue of queues) {
    const org = queue?.organization || { id: "default", slug: "main", name: "" };
    const venue = queue?.venue || { id: "none", slug: "", name: "" };
    const orgId = String(org.id || "default");
    const venueId = String(venue.id || "none");
    if (!orgs.has(orgId)) orgs.set(orgId, { org: { ...org, id: orgId }, venues: new Map() });
    const group = orgs.get(orgId);
    if (!group.venues.has(venueId)) group.venues.set(venueId, { venue: { ...venue, id: venueId }, queues: [] });
    group.venues.get(venueId).queues.push(queue);
  }
  const byName = (a, b) => String(a || "").localeCompare(String(b || ""));
  const groups = [...orgs.values()]
    .map((group) => ({
      org: group.org,
      venues: [...group.venues.values()]
        .map((venueGroup) => ({
          ...venueGroup,
          queues: [...venueGroup.queues].sort((a, b) => byName(a.name, b.name)),
        }))
        .sort((a, b) => byName(a.venue.name, b.venue.name)),
    }))
    .sort((a, b) => String(a.org.name || "").localeCompare(String(b.org.name || "")));
  return { showOrgHeadings: groups.length > 1, groups };
}

/** Same wait sentence as catalog cards, plus a low-confidence hint when useful. */
export function boardWaitCopy(waitEstimate, locale = "en") {
  const wait = catalogWaitLabel(waitEstimate, locale);
  if (!wait) return { wait: null, confidence: null };
  const confidence =
    waitEstimate?.confidence === "low" || waitEstimate?.source === "configured"
      ? confidenceLabel(waitEstimate.confidence || "low", locale)
      : null;
  return { wait, confidence };
}

export function boardLastUpdated(generatedAt, nowMs, locale = "en") {
  const at = generatedAt ? Date.parse(generatedAt) : NaN;
  return formatAgo(Number.isFinite(at) ? at : null, nowMs, locale);
}

export function boardPollMs({ hidden = false, refreshSeconds = DEFAULT_BOARD_REFRESH_SECONDS, failures = 0 } = {}) {
  return livePollMs({ hidden, refreshSeconds, failures });
}
