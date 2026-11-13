import crypto from "crypto";
import { LoginThrottle } from "../models/LoginThrottle.js";
import { now as clockNow } from "./clock.js";
import { recordAdminAudit } from "./adminAudit.js";

/**
 * Account + IP lockout for sign-in (password and two-step code).
 * Counts only failures; a lock answers with the same generic 429 as the
 * rate limiter, whether or not the account exists, so it reveals nothing.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const ACCOUNT_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 30;
export const TOO_MANY_ATTEMPTS = "Too many attempts, try again later";

export const LOCKOUT_ACTOR = { _id: "system", name: "QueueIt (automatic)", email: null, role: "system" };

function hashKey(scope, value) {
  return `${scope}:${crypto.createHash("sha256").update(String(value || "").toLowerCase()).digest("hex").slice(0, 40)}`;
}

function keysFor({ email, ip }) {
  const keys = [];
  if (email) keys.push({ scope: "account", key: hashKey("account", email), max: ACCOUNT_MAX_FAILURES, label: email });
  if (ip) keys.push({ scope: "ip", key: hashKey("ip", ip), max: IP_MAX_FAILURES, label: ip });
  return keys;
}

/** Is this email or IP currently locked? Returns { locked, retryAfterSeconds }. */
export async function loginLockStatus({ email, ip }) {
  const at = clockNow();
  const keys = keysFor({ email, ip }).map((k) => k.key);
  if (keys.length === 0) return { locked: false };
  const rows = await LoginThrottle.find({ key: { $in: keys }, lockedUntil: { $gt: at } }).select("lockedUntil").lean();
  if (rows.length === 0) return { locked: false };
  const until = Math.max(...rows.map((r) => new Date(r.lockedUntil).getTime()));
  return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((until - at.getTime()) / 1000)) };
}

async function bump({ scope, key, max, label }, at, { stage }) {
  const windowFloor = new Date(at.getTime() - LOGIN_WINDOW_MS);
  const expiresAt = new Date(at.getTime() + LOGIN_WINDOW_MS + LOGIN_LOCK_MS);
  let doc = await LoginThrottle.findOneAndUpdate(
    { key, windowStart: { $gt: windowFloor } },
    { $inc: { count: 1 }, $set: { expiresAt } },
    { returnDocument: "after" }
  );
  if (!doc) {
    try {
      doc = await LoginThrottle.findOneAndUpdate(
        { key },
        { $set: { scope, count: 1, windowStart: at, expiresAt } },
        { returnDocument: "after", upsert: true }
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
      doc = await LoginThrottle.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { returnDocument: "after" });
    }
  }
  if (!doc || doc.count < max) return false;
  if (doc.lockedUntil && doc.lockedUntil > at) return false;
  const lockedUntil = new Date(at.getTime() + LOGIN_LOCK_MS);
  const locked = await LoginThrottle.findOneAndUpdate(
    { key, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: at } }] },
    { $set: { lockedUntil, count: 0, windowStart: at, expiresAt: new Date(lockedUntil.getTime() + LOGIN_WINDOW_MS) } },
    { returnDocument: "after" }
  );
  if (!locked) return false;
  await recordAdminAudit({
    actor: LOCKOUT_ACTOR,
    action: "login-lockout",
    meta: {
      scope,
      ...(scope === "account" ? { email: label } : { ip: label }),
      failures: max,
      minutes: Math.round(LOGIN_LOCK_MS / 60000),
      stage,
    },
  });
  return true;
}

/** Count one failed attempt for the email and the IP; locks when a limit is hit. */
export async function recordLoginFailure({ email, ip, stage = "password" }) {
  const at = clockNow();
  let lockedNow = false;
  for (const k of keysFor({ email, ip })) {
    if (await bump(k, at, { stage })) lockedNow = true;
  }
  return { lockedNow };
}

/** Successful sign-in clears the account counter (the IP counter keeps running). */
export async function clearAccountFailures(email) {
  if (!email) return;
  await LoginThrottle.deleteOne({ key: hashKey("account", email) });
}
