import crypto from "crypto";
import { User } from "../models/User.js";
import { PasswordReset } from "../models/PasswordReset.js";
import { sendPasswordReset } from "./mailer.js";
import { publicClientOrigin } from "../corsOrigin.js";
import { passwordError } from "./authValidation.js";
import { clearAccountFailures } from "./loginThrottle.js";

export const RESET_NOTICE = "If an account exists for that email, we sent a reset link.";
export const RESET_INVALID = "This reset link is invalid or has expired.";
export const DEFAULT_RESET_EXPIRES_MINUTES = 60;

export function resetExpiryMs() {
  const mins = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES);
  if (Number.isInteger(mins) && mins >= 1 && mins <= 24 * 60) {
    return mins * 60 * 1000;
  }
  return DEFAULT_RESET_EXPIRES_MINUTES * 60 * 1000;
}

export function hashResetToken(raw) {
  return crypto.createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

export function issueResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function resetLinkFor(rawToken) {
  const origin = publicClientOrigin();
  return `${origin}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/**
 * Always safe to call: if the email is not registered we do nothing.
 * @returns {Promise<{ sent: boolean }>}
 */
export async function requestPasswordReset(email) {
  const user = await User.findOne({ email });
  if (!user) return { sent: false };

  await PasswordReset.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } });

  const raw = issueResetToken();
  await PasswordReset.create({
    user: user._id,
    tokenHash: hashResetToken(raw),
    expiresAt: new Date(Date.now() + resetExpiryMs()),
  });

  try {
    await sendPasswordReset({ to: user.email, resetUrl: resetLinkFor(raw) });
  } catch (err) {
    console.error("[queueit-mailer] Failed to send password reset", err);
  }
  return { sent: true };
}

/**
 * Consume a one-time token and set a new password.
 * @returns {Promise<{ ok: true, user: import("mongoose").Document } | { ok: false, status: number, error: string }>}
 */
export async function consumePasswordReset({ token, password }) {
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw) return { ok: false, status: 400, error: RESET_INVALID };
  const problem = passwordError(password);
  if (problem) return { ok: false, status: 400, error: problem };

  const doc = await PasswordReset.findOneAndUpdate(
    {
      tokenHash: hashResetToken(raw),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!doc) return { ok: false, status: 400, error: RESET_INVALID };

  const user = await User.findById(doc.user).select("+passwordHash");
  if (!user) return { ok: false, status: 400, error: RESET_INVALID };
  user.passwordHash = await User.hashPassword(password);
  // A new password signs out every existing session and clears any lockout.
  user.tokenVersion = (Number(user.tokenVersion) || 0) + 1;
  await user.save();
  await PasswordReset.updateMany({ user: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
  await clearAccountFailures(user.email);
  return { ok: true, user };
}
