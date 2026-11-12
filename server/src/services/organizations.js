/**
 * Organizations: tenants that own venues. The default organization is
 * virtual (never stored); it owns every venue whose `organization` is null.
 */
import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { Venue } from "../models/Venue.js";
import { Queue } from "../models/Queue.js";
import { slugifyName } from "./catalogAdmin.js";

export const DEFAULT_ORG_ID = "default";
export const DEFAULT_ORG_SLUG = "main";
export const DEFAULT_ORG_NAME = "Main campus";
export const ORG_NAME_MAX = 60;

export class OrgError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function defaultOrgJSON() {
  return { id: DEFAULT_ORG_ID, slug: DEFAULT_ORG_SLUG, name: DEFAULT_ORG_NAME, isDefault: true };
}

/** Org id string for a venue (or "default"). */
export function orgIdOfVenue(venue) {
  const id = venue?.organization?._id ?? venue?.organization;
  return id ? String(id) : DEFAULT_ORG_ID;
}

function cleanOrgName(raw) {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new OrgError(400, "Organization name is required");
  if (name.length > ORG_NAME_MAX) throw new OrgError(400, `Keep the name under ${ORG_NAME_MAX} characters`);
  return name;
}

async function uniqueOrgSlug(base, excludeId = null) {
  const root = base === DEFAULT_ORG_SLUG || base === DEFAULT_ORG_ID ? `${base}-org` : base;
  let slug = root;
  let n = 2;
  for (;;) {
    const filter = { slug };
    if (excludeId) filter._id = { $ne: excludeId };
    if (!(await Organization.exists(filter))) return slug;
    slug = `${root}-${n++}`;
  }
}

/**
 * Every organization with live venue and queue counts. The default org is
 * listed first when it owns anything, or when no other org exists.
 */
export async function listOrganizations({ includeEmpty = false } = {}) {
  const [orgs, venues, queueCounts] = await Promise.all([
    Organization.find({}).sort({ name: 1 }),
    Venue.find({}).select("organization"),
    Queue.aggregate([{ $match: { archivedAt: null } }, { $group: { _id: "$venue", n: { $sum: 1 } } }]),
  ]);
  const queuesByVenue = new Map(queueCounts.map((r) => [String(r._id), r.n]));
  const counts = new Map();
  for (const venue of venues) {
    const key = orgIdOfVenue(venue);
    const c = counts.get(key) || { venues: 0, queues: 0 };
    c.venues += 1;
    c.queues += queuesByVenue.get(String(venue._id)) || 0;
    counts.set(key, c);
  }
  const withCounts = (json) => ({ ...json, venueCount: counts.get(json.id)?.venues || 0, queueCount: counts.get(json.id)?.queues || 0 });
  const out = [];
  const def = withCounts(defaultOrgJSON());
  if (def.venueCount > 0 || orgs.length === 0 || includeEmpty) out.push(def);
  for (const org of orgs) {
    const row = withCounts(org.toPublicJSON());
    if (includeEmpty || row.queueCount > 0) out.push(row);
  }
  return out;
}

/** Resolve an org by id or slug. Returns { id, isDefault, doc } or null. */
export async function findOrganization(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase();
  if (k === DEFAULT_ORG_ID || k === DEFAULT_ORG_SLUG) return { id: DEFAULT_ORG_ID, isDefault: true, doc: null };
  const doc = mongoose.isValidObjectId(k) ? await Organization.findById(k) : await Organization.findOne({ slug: k });
  return doc ? { id: String(doc._id), isDefault: false, doc } : null;
}

/** Venue ids owned by an org (resolved via findOrganization). */
export async function venueIdsForOrg(org) {
  const filter = org.isDefault ? { organization: null } : { organization: org.doc._id };
  return (await Venue.find(filter).select("_id")).map((v) => v._id);
}

export async function createOrganization({ name }) {
  const clean = cleanOrgName(name);
  const slug = await uniqueOrgSlug(slugifyName(clean));
  return Organization.create({ name: clean, slug });
}

export async function renameOrganization(id, { name }) {
  if (id === DEFAULT_ORG_ID) throw new OrgError(400, "The main campus name is fixed");
  const doc = mongoose.isValidObjectId(id) ? await Organization.findById(id) : null;
  if (!doc) throw new OrgError(404, "Organization not found");
  const previous = doc.name;
  doc.name = cleanOrgName(name);
  await doc.save();
  return { doc, previous };
}

/** Move a venue to an org ("default" or an id). Returns { venue, from, to } names. */
export async function moveVenue(venue, organizationId) {
  const target = await findOrganization(organizationId);
  if (!target) throw new OrgError(404, "Organization not found");
  const fromId = orgIdOfVenue(venue);
  if (fromId === target.id) return { venue, changed: false };
  const fromOrg = fromId === DEFAULT_ORG_ID ? null : await Organization.findById(fromId).select("name");
  venue.organization = target.isDefault ? null : target.doc._id;
  await venue.save();
  return {
    venue,
    changed: true,
    from: fromOrg?.name || DEFAULT_ORG_NAME,
    to: target.isDefault ? DEFAULT_ORG_NAME : target.doc.name,
  };
}
