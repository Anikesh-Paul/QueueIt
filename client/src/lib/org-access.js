/**
 * Helpers for the Access page (global admins assign admins and staff to
 * organizations). The server enforces every rule; these only shape the UI.
 */

/** One line describing what someone can manage. */
export function scopeSummary(person) {
  if (!person) return "";
  if (person.role === "admin") {
    if (person.scope === "global" || !(person.organizations || []).length) return "All organizations";
    return person.organizations.map((org) => org.name).join(", ");
  }
  const org = person.organizations?.[0]?.name;
  const venue = person.venue?.name || "No venue";
  return org ? `${venue} · ${org}` : venue;
}

/** Add or remove one organization id, keeping the original order. */
export function toggleOrg(list, id, checked) {
  const current = Array.isArray(list) ? list : [];
  if (checked) return current.includes(id) ? current : [...current, id];
  return current.filter((value) => value !== id);
}

/** Same set of organization ids, ignoring order. */
export function sameOrgs(a, b) {
  const left = [...new Set(a || [])].sort();
  const right = [...new Set(b || [])].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

/** Venues grouped under their organization, for an <optgroup> picker. */
export function venuesByOrg(venues, orgs) {
  const groups = (orgs || []).map((org) => ({ id: org.id, name: org.name, venues: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const venue of venues || []) {
    const key = venue.organizationId || "default";
    let group = byId.get(key);
    if (!group) {
      group = { id: key, name: key === "default" ? "Main campus" : "Other", venues: [] };
      byId.set(key, group);
      groups.push(group);
    }
    group.venues.push(venue);
  }
  return groups.filter((group) => group.venues.length);
}

/** Admins first (globals before scoped), then staff; by name within each. */
export function sortPeople(people) {
  const rank = (p) => (p.role === "admin" ? (p.scope === "global" ? 0 : 1) : 2);
  return [...(people || [])].sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}
