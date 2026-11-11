/**
 * Abuse limits for no-login (Guest) joins from posters, kiosks and links.
 * Signed-in users and staff walk-ins are not affected. Queue caps, the
 * closed gate and priority lanes are enforced by the join route as before.
 */
import crypto from "node:crypto";
import { Guest } from "../models/Guest.js";
import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "../models/QueueEntry.js";
import { now as clockNow } from "./clock.js";

/** Active places (waiting / serving) one guest pass may hold across queues. */
export const GUEST_MAX_ACTIVE_PLACES = 2;
/** No-shows within the window that pause guest joining for that pass. */
export const GUEST_NO_SHOW_LIMIT = 2;
export const GUEST_NO_SHOW_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Default new guest passes per network per hour (campus Wi-Fi shares one IP, so keep it roomy). */
export const DEFAULT_GUEST_MINTS_PER_HOUR = 60;
const MINT_WINDOW_MS = 60 * 60 * 1000;

export const GUEST_JOIN_DISABLED = "This queue needs you to sign in to join";

/** Optional env override; anything invalid falls back to the default. */
export function guestMintsPerHour(env = process.env) {
  const raw = Number(env.GUEST_MINTS_PER_HOUR);
  return Number.isInteger(raw) && raw >= 1 && raw <= 10_000 ? raw : DEFAULT_GUEST_MINTS_PER_HOUR;
}

/**
 * Keyed hash of a client address. Uses JWT_SECRET as the key so the stored
 * value can't be reversed with a rainbow table of IPv4 addresses.
 */
export function networkHashOf(ip) {
  const address = String(ip || "").trim();
  if (!address) return null;
  const key = process.env.JWT_SECRET || "queueit-network-hash";
  return crypto.createHmac("sha256", key).update(`guest-network:${address}`).digest("hex");
}

/**
 * Checks for an existing guest pass (before inserting a new place).
 * @returns {Promise<{ status: number, body: object } | null>}
 */
export async function checkExistingGuest(guest, at = clockNow()) {
  if (!guest) return null;
  const active = await QueueEntry.countDocuments({ guest: guest._id, status: { $in: ACTIVE_ENTRY_STATUSES } });
  if (active >= GUEST_MAX_ACTIVE_PLACES) {
    return {
      status: 429,
      body: {
        error: `You can hold ${GUEST_MAX_ACTIVE_PLACES} places at a time as a guest. Leave one, or sign in to join more.`,
        code: "guest-active-limit",
      },
    };
  }
  const since = new Date(at.getTime() - GUEST_NO_SHOW_WINDOW_MS);
  const noShows = await QueueEntry.countDocuments({
    guest: guest._id,
    status: "skipped",
    updatedAt: { $gte: since },
  });
  if (noShows >= GUEST_NO_SHOW_LIMIT) {
    return {
      status: 429,
      body: {
        error: "You missed your last turns, so guest joining is paused for a few hours. Sign in to join now.",
        code: "guest-no-show-cooldown",
      },
    };
  }
  return null;
}

/**
 * Cap brand-new guest passes from one network.
 * @returns {Promise<{ status: number, body: object } | null>}
 */
export async function checkGuestMint(networkHash, at = clockNow(), env = process.env) {
  if (!networkHash) return null;
  const since = new Date(at.getTime() - MINT_WINDOW_MS);
  const recent = await Guest.countDocuments({ networkHash, createdAt: { $gte: since } });
  if (recent >= guestMintsPerHour(env)) {
    return {
      status: 429,
      body: {
        error: "Too many new guest passes from this network. Try again in a while, or sign in to join.",
        code: "guest-mint-limit",
      },
    };
  }
  return null;
}
