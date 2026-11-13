/**
 * Organization assignments for console accounts (global admins only).
 *
 * - Admins: `adminOrganizations` limits them to those organizations; an
 *   empty list makes them a global admin again.
 * - Staff: always belong to exactly one organization through their venue, so
 *   assigning a staff member to an organization means moving them to a venue
 *   in it.
 */
import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Venue } from "../models/Venue.js";
import { Organization } from "../models/Organization.js";
import { isValidEmail, normalizeEmail, normalizeName, passwordError } from "./authValidation.js";
import { DEFAULT_ORG_ID, DEFAULT_ORG_NAME, findOrganization, orgIdOfVenue } from "./organizations.js";
import { requestPasswordReset } from "./passwordReset.js";
import crypto from "crypto";

export const MAX_ADMIN_ORGS = 20;

export class ScopeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Map of org id → name for the given ids ("default" included). */
export async function orgNames(ids) {
  const out = new Map();
  const objectIds = [...new Set(ids.filter((id) => id !== DEFAULT_ORG_ID && mongoose.isValidObjectId(id)))];
  if (ids.includes(DEFAULT_ORG_ID)) out.set(DEFAULT_ORG_ID, DEFAULT_ORG_NAME);
  if (objectIds.length) {
    for (const org of await Organization.find({ _id: { $in: objectIds } }).select("name")) {
      out.set(String(org._id), org.name);
    }
  }
  return out;
}

function describeScope(ids, names) {
  if (!ids.length) return "All organizations";
  return ids.map((id) => names.get(id) || "Removed organization").join(", ");
}

/** Validate and normalise a list of organization ids/slugs. */
export async function resolveOrganizationIds(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new ScopeError(400, "Organizations must be a list");
  if (raw.length > MAX_ADMIN_ORGS) throw new ScopeError(400, `Pick at most ${MAX_ADMIN_ORGS} organizations`);
  const out = [];
  for (const key of raw) {
    const org = await findOrganization(typeof key === "string" ? key : String(key ?? ""));
    if (!org) throw new ScopeError(404, "Organization not found");
    if (!out.includes(org.id)) out.push(org.id);
  }
  return out;
}

function isGlobalRecord(user) {
  return user.role === "admin" && !(user.adminOrganizations || []).length;
}

async function otherGlobalAdmins(excludeId) {
  return User.countDocuments({
    _id: { $ne: excludeId },
    role: "admin",
    $or: [{ adminOrganizations: { $exists: false } }, { adminOrganizations: { $size: 0 } }],
  });
}

/** Admins and staff with their organization scope, for the Access screen. */
export async function listConsolePeople() {
  const people = await User.find({ role: { $in: ["admin", "staff"] } }).sort({ role: 1, name: 1, email: 1 });
  const venueIds = people.filter((p) => p.role === "staff" && p.staffVenue).map((p) => p.staffVenue);
  const venues = await Venue.find({ _id: { $in: venueIds } }).select("name organization");
  const venueById = new Map(venues.map((v) => [String(v._id), v]));
  const orgIds = new Set();
  for (const p of people) for (const id of p.adminOrganizations || []) orgIds.add(String(id));
  for (const v of venues) orgIds.add(orgIdOfVenue(v));
  const names = await orgNames([...orgIds]);
  return people.map((p) => {
    const json = p.toPublicJSON();
    if (p.role === "admin") {
      const ids = (p.adminOrganizations || []).map(String);
      return {
        ...json,
        scope: ids.length ? "organizations" : "global",
        organizations: ids.map((id) => ({ id, name: names.get(id) || "Removed organization" })),
      };
    }
    const venue = venueById.get(String(p.staffVenue));
    const orgId = venue ? orgIdOfVenue(venue) : null;
    return {
      ...json,
      scope: "venue",
      venue: venue ? { id: String(venue._id), name: venue.name } : null,
      organizations: orgId ? [{ id: orgId, name: names.get(orgId) || DEFAULT_ORG_NAME }] : [],
    };
  });
}

/**
 * Set an admin's organizations ([] = global). Global admins only; you can't
 * change your own scope, and the last global admin can't be scoped.
 * @returns {Promise<{ user, changed: boolean, from: string, to: string }>}
 */
export async function setAdminOrganizations({ actor, userId, organizationIds }) {
  if (!mongoose.isValidObjectId(userId)) throw new ScopeError(404, "Admin not found");
  const target = await User.findById(userId);
  if (!target || target.role !== "admin") throw new ScopeError(404, "Admin not found");
  if (String(target._id) === String(actor._id)) {
    throw new ScopeError(400, "You can't change your own access. Ask another global admin.");
  }
  const next = await resolveOrganizationIds(organizationIds);
  const before = (target.adminOrganizations || []).map(String);
  if (next.length && isGlobalRecord(target) && (await otherGlobalAdmins(target._id)) === 0) {
    throw new ScopeError(409, "Keep at least one global admin");
  }
  const names = await orgNames([...before, ...next]);
  const from = describeScope(before, names);
  const to = describeScope(next, names);
  const changed = before.length !== next.length || before.some((id, i) => id !== next[i]);
  if (changed) {
    target.adminOrganizations = next;
    await target.save();
  }
  return { user: target, changed, from, to };
}

/** Create an organization admin account (global admins only). */
export async function inviteAdmin({ name, email, temporaryPassword, organizationIds }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) throw new ScopeError(400, "Enter a valid email address");
  const named = normalizeName(name);
  if (!named.ok) throw new ScopeError(400, named.error);
  const orgs = await resolveOrganizationIds(organizationIds);
  if (!orgs.length) throw new ScopeError(400, "Pick at least one organization");
  if (await User.exists({ email: normalized })) throw new ScopeError(409, "Email already registered");
  let password = temporaryPassword;
  let generated = false;
  if (password == null || password === "") {
    password = crypto.randomBytes(12).toString("base64url");
    generated = true;
  }
  const problem = passwordError(password);
  if (problem) throw new ScopeError(400, problem);
  const user = await User.create({
    email: normalized,
    name: named.name,
    passwordHash: await User.hashPassword(password),
    role: "admin",
    adminOrganizations: orgs,
  });
  if (generated) await requestPasswordReset(normalized);
  const names = await orgNames(orgs);
  return { user, temporaryPassword: password, resetSent: generated, scope: describeScope(orgs, names) };
}
