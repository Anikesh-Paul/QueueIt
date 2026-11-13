import crypto from "crypto";
import { User } from "../models/User.js";
import { isConsoleUser } from "./staffAccess.js";
import { now as clockNow } from "./clock.js";
import { generateTotpSecret, normalizeTotpInput, otpauthUrl, verifyTotp } from "./totp.js";
import { openSecret, sealSecret } from "./secretBox.js";

/** Two-step sign-in for admin and staff accounts (opt-in). */
export const BACKUP_CODE_COUNT = 10;
export const PENDING_SETUP_MS = 15 * 60 * 1000;
export const TWO_FACTOR_SELECT =
  "+passwordHash +twoFactorSecret +twoFactorPendingSecret +twoFactorPendingAt +twoFactorBackupCodes +twoFactorLastStep";

export const INVALID_CODE = "That code didn't work. Check your authenticator app and try again.";

export function canUseTwoFactor(user) {
  return Boolean(user) && isConsoleUser(user);
}

export function hashBackupCode(code) {
  const clean = String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return crypto.createHash("sha256").update(`queueit-backup:${clean}`).digest("hex");
}

/** 10 codes like "k3f9q-7xm2p" (50 bits each), shown once. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = [];
  while (codes.length < count) {
    const bytes = crypto.randomBytes(10);
    let raw = "";
    for (const b of bytes) raw += alphabet[b % alphabet.length];
    const code = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

export async function loadWithSecrets(userId) {
  return User.findById(userId).select(TWO_FACTOR_SELECT);
}

export function twoFactorStatus(user) {
  return {
    eligible: canUseTwoFactor(user),
    enabled: Boolean(user.twoFactorEnabled),
    enabledAt: user.twoFactorEnabledAt ? user.twoFactorEnabledAt.toISOString() : null,
    backupCodesRemaining: Array.isArray(user.twoFactorBackupCodes) ? user.twoFactorBackupCodes.length : null,
  };
}

/** Step 1: new seed (pending until confirmed). Needs the current password. */
export async function beginSetup(user, password) {
  if (!canUseTwoFactor(user)) return { ok: false, status: 403, error: "Two-step sign-in is for admin and staff accounts" };
  if (user.twoFactorEnabled) return { ok: false, status: 409, error: "Two-step sign-in is already on" };
  if (typeof password !== "string" || !password || !(await user.comparePassword(password))) {
    return { ok: false, status: 401, error: "Your password is incorrect" };
  }
  const secret = generateTotpSecret();
  user.twoFactorPendingSecret = sealSecret(secret);
  user.twoFactorPendingAt = clockNow();
  await user.save();
  return { ok: true, secret, otpauthUrl: otpauthUrl({ secret, account: user.email }) };
}

/** Step 2: first code confirms the app is set up; returns one-time backup codes. */
export async function confirmSetup(user, code) {
  if (!canUseTwoFactor(user)) return { ok: false, status: 403, error: "Two-step sign-in is for admin and staff accounts" };
  if (user.twoFactorEnabled) return { ok: false, status: 409, error: "Two-step sign-in is already on" };
  const startedAt = user.twoFactorPendingAt?.getTime?.() ?? 0;
  const secret = openSecret(user.twoFactorPendingSecret);
  if (!secret || clockNow().getTime() - startedAt > PENDING_SETUP_MS) {
    return { ok: false, status: 400, error: "Setup expired. Start again." };
  }
  const step = verifyTotp(secret, code, { atMs: clockNow().getTime() });
  if (step == null) return { ok: false, status: 400, error: INVALID_CODE };
  const backupCodes = generateBackupCodes();
  user.twoFactorEnabled = true;
  user.twoFactorEnabledAt = clockNow();
  user.twoFactorSecret = sealSecret(secret);
  user.twoFactorPendingSecret = null;
  user.twoFactorPendingAt = null;
  user.twoFactorLastStep = step;
  user.twoFactorBackupCodes = backupCodes.map(hashBackupCode);
  await user.save();
  return { ok: true, backupCodes };
}

/**
 * Check a sign-in code: a 6-digit authenticator code (each usable once) or a
 * one-time backup code (consumed). Saves the user on success.
 * @returns {Promise<{ ok: boolean, method?: "totp" | "backup" }>}
 */
export async function verifySecondFactor(user, code) {
  if (!user?.twoFactorEnabled) return { ok: false };
  const input = normalizeTotpInput(code);
  if (/^\d{6}$/.test(input)) {
    const secret = openSecret(user.twoFactorSecret);
    if (!secret) return { ok: false };
    const step = verifyTotp(secret, input, {
      atMs: clockNow().getTime(),
      afterStep: user.twoFactorLastStep ?? null,
    });
    if (step == null) return { ok: false };
    // Atomic: only one request can claim this step.
    const claimed = await User.updateOne(
      { _id: user._id, $or: [{ twoFactorLastStep: null }, { twoFactorLastStep: { $lt: step } }] },
      { $set: { twoFactorLastStep: step } }
    );
    if (claimed.modifiedCount !== 1) return { ok: false };
    user.twoFactorLastStep = step;
    return { ok: true, method: "totp" };
  }
  const hash = hashBackupCode(code);
  if (!String(code || "").trim()) return { ok: false };
  const used = await User.updateOne(
    { _id: user._id, twoFactorBackupCodes: hash },
    { $pull: { twoFactorBackupCodes: hash } }
  );
  if (used.modifiedCount !== 1) return { ok: false };
  user.twoFactorBackupCodes = (user.twoFactorBackupCodes || []).filter((h) => h !== hash);
  return { ok: true, method: "backup" };
}

/** Turn it off — requires a current authenticator or backup code. */
export async function disableTwoFactor(user, code) {
  if (!user.twoFactorEnabled) return { ok: false, status: 409, error: "Two-step sign-in is already off" };
  const check = await verifySecondFactor(user, code);
  if (!check.ok) return { ok: false, status: 400, error: INVALID_CODE };
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        twoFactorEnabled: false,
        twoFactorEnabledAt: null,
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorPendingAt: null,
        twoFactorBackupCodes: [],
        twoFactorLastStep: null,
      },
    }
  );
  return { ok: true, method: check.method };
}

/** New set of backup codes (old ones stop working) — requires a current code. */
export async function regenerateBackupCodes(user, code) {
  if (!user.twoFactorEnabled) return { ok: false, status: 409, error: "Two-step sign-in is off" };
  const check = await verifySecondFactor(user, code);
  if (!check.ok) return { ok: false, status: 400, error: INVALID_CODE };
  const backupCodes = generateBackupCodes();
  await User.updateOne({ _id: user._id }, { $set: { twoFactorBackupCodes: backupCodes.map(hashBackupCode) } });
  return { ok: true, backupCodes };
}
