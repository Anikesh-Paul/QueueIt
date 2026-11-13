import { Router } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { Guest } from "../models/Guest.js";
import {
  GUEST_CREDENTIAL_HEADER,
  requireAuth,
  signToken,
  signTwoFactorChallenge,
  tokenVersionOf,
  verifyTwoFactorChallenge,
} from "../middleware/auth.js";
import {
  TOO_MANY_ATTEMPTS,
  clearAccountFailures,
  loginLockStatus,
  recordLoginFailure,
} from "../services/loginThrottle.js";
import {
  INVALID_CODE,
  beginSetup,
  confirmSetup,
  disableTwoFactor,
  loadWithSecrets,
  regenerateBackupCodes,
  twoFactorStatus,
  verifySecondFactor,
} from "../services/twoFactor.js";
import { recordAdminAudit } from "../services/adminAudit.js";
import { claimGuestOntoUser } from "../services/softUpgrade.js";
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  passwordError,
} from "../services/authValidation.js";
import {
  RESET_NOTICE,
  requestPasswordReset,
  consumePasswordReset,
} from "../services/passwordReset.js";

const router = Router();

/** bcrypt hash of a throwaway string (cost 10, same as real hashes). */
const TIMING_DUMMY_HASH = "$2b$10$n4ViOQQnNF3FSqw4syrd9urKchrGPWByovN7TksHdicrZ3ru7qYOa";

export const INVALID_LOGIN = "Invalid email or password";
export const CHALLENGE_EXPIRED = "Your sign-in timed out. Enter your email and password again.";

function tooMany(res, retryAfterSeconds) {
  if (retryAfterSeconds) res.set("Retry-After", String(retryAfterSeconds));
  return res.status(429).json({ error: TOO_MANY_ATTEMPTS });
}

/** Password (and reset) succeeded: either a session, or the two-step challenge. */
async function finishSignIn(req, res, user, status = 200) {
  if (user.twoFactorEnabled) {
    return res.status(200).json({
      twoFactorRequired: true,
      challenge: signTwoFactorChallenge(user),
    });
  }
  await clearAccountFailures(user.email);
  const softUpgrade = await softUpgradeFromRequest(req, user);
  const body = { token: signToken(user), user: user.toPublicJSON() };
  if (softUpgrade) body.softUpgrade = softUpgrade;
  return res.status(status).json(body);
}

/**
 * Soft upgrade: if a non-retired Guest credential is present, claim its
 * memberships + device-local history onto a student User and retire the credential.
 * Admin sessions ignore Guest credentials (JWT wins; claim is student-path only).
 * @returns {Promise<{ claimed: number } | null>}
 */
async function softUpgradeFromRequest(req, user) {
  if (!user || user.role !== "user") return null;

  const raw = req.headers[GUEST_CREDENTIAL_HEADER];
  if (!raw || typeof raw !== "string") return null;
  const credential = raw.trim();
  if (!credential) return null;

  const guest = await Guest.findActiveByPresentedCredential(credential);
  if (!guest) return null;

  return claimGuestOntoUser(guest, user);
}

/** POST /api/auth/register — create a student (user role only); optional soft upgrade. */
router.post("/register", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const named = normalizeName(req.body?.name);

    if (!email || password == null || password === "") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    const passwordProblem = passwordError(password);
    if (passwordProblem) {
      return res.status(400).json({ error: passwordProblem });
    }
    if (!named.ok) {
      return res.status(400).json({ error: named.error });
    }
    const name = named.name;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email,
      name,
      passwordHash,
      role: "user",
    });

    const softUpgrade = await softUpgradeFromRequest(req, user);

    const token = signToken(user);
    const body = {
      token,
      user: user.toPublicJSON(),
    };
    if (softUpgrade) {
      body.softUpgrade = softUpgrade;
    }
    return res.status(201).json(body);
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/login — email/password → JWT session; optional soft upgrade. */
router.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!email || password == null || password === "") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    if (typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length > 128) {
      return res.status(400).json({ error: "Password must be at most 128 characters" });
    }

    const lockout = req.app.locals.loginLockout !== false;
    if (lockout) {
      const lock = await loginLockStatus({ email, ip: req.ip });
      if (lock.locked) return tooMany(res, lock.retryAfterSeconds);
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    // Unknown emails still pay for a bcrypt compare, so timing reveals nothing.
    const ok = user
      ? await user.comparePassword(password)
      : (await bcrypt.compare(password, TIMING_DUMMY_HASH), false);
    if (!ok) {
      if (lockout) {
        const { lockedNow } = await recordLoginFailure({ email, ip: req.ip, stage: "password" });
        if (lockedNow) return tooMany(res, null);
      }
      return res.status(401).json({ error: INVALID_LOGIN });
    }

    return finishSignIn(req, res, user);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/login/2fa — second step for accounts with two-step sign-in.
 * Body: { challenge, code } where code is a 6-digit authenticator code or a
 * one-time backup code. Failures count toward the account/IP lockout.
 */
router.post("/login/2fa", async (req, res, next) => {
  try {
    const challenge = verifyTwoFactorChallenge(req.body?.challenge);
    if (!challenge) return res.status(401).json({ error: CHALLENGE_EXPIRED });
    const user = await loadWithSecrets(challenge.sub);
    if (!user || !user.twoFactorEnabled || tokenVersionOf(user) !== challenge.tv) {
      return res.status(401).json({ error: CHALLENGE_EXPIRED });
    }

    const lockout = req.app.locals.loginLockout !== false;
    if (lockout) {
      const lock = await loginLockStatus({ email: user.email, ip: req.ip });
      if (lock.locked) return tooMany(res, lock.retryAfterSeconds);
    }

    const check = await verifySecondFactor(user, req.body?.code);
    if (!check.ok) {
      if (lockout) {
        const { lockedNow } = await recordLoginFailure({ email: user.email, ip: req.ip, stage: "two-step" });
        if (lockedNow) return tooMany(res, null);
      }
      return res.status(401).json({ error: INVALID_CODE });
    }

    await clearAccountFailures(user.email);
    const body = { token: signToken(user), user: user.toPublicJSON() };
    if (check.method === "backup") {
      body.backupCodesRemaining = (user.twoFactorBackupCodes || []).length;
    }
    return res.status(200).json(body);
  } catch (err) {
    return next(err);
  }
});

/** GET /api/auth/me — current session user (protected). */
router.get("/me", requireAuth, async (req, res) => {
  return res.status(200).json({ user: req.user.toPublicJSON() });
});

/**
 * POST /api/auth/forgot-password — always a generic 200 so the response
 * does not reveal whether the email is registered.
 */
router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    await requestPasswordReset(email);
    return res.status(200).json({ message: RESET_NOTICE });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/reset-password — consume a one-time token, set a new
 * password, and sign the user in.
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    const result = await consumePasswordReset({
      token: req.body?.token,
      password: req.body?.password,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    // A reset never skips two-step sign-in: 2FA accounts still need a code.
    return finishSignIn(req, res, result.user);
  } catch (err) {
    return next(err);
  }
});

/** GET /api/auth/2fa — two-step status for the signed-in account. */
router.get("/2fa", requireAuth, async (req, res, next) => {
  try {
    const user = await loadWithSecrets(req.user._id);
    return res.status(200).json({ twoFactor: twoFactorStatus(user) });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/2fa/setup { password } — new seed for the QR code (admin/staff). */
router.post("/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    const user = await loadWithSecrets(req.user._id);
    const result = await beginSetup(user, req.body?.password);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({ secret: result.secret, otpauthUrl: result.otpauthUrl });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/2fa/enable { code } — confirm the app; returns backup codes once. */
router.post("/2fa/enable", requireAuth, async (req, res, next) => {
  try {
    const user = await loadWithSecrets(req.user._id);
    const result = await confirmSetup(user, req.body?.code);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await recordAdminAudit({ actor: user, action: "2fa-enabled" });
    return res.status(200).json({
      backupCodes: result.backupCodes,
      twoFactor: twoFactorStatus(user),
      user: user.toPublicJSON(),
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/2fa/disable { code } — needs a current authenticator or backup code. */
router.post("/2fa/disable", requireAuth, async (req, res, next) => {
  try {
    const user = await loadWithSecrets(req.user._id);
    const result = await disableTwoFactor(user, req.body?.code);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await recordAdminAudit({ actor: user, action: "2fa-disabled", meta: { with: result.method } });
    const fresh = await loadWithSecrets(req.user._id);
    return res.status(200).json({ twoFactor: twoFactorStatus(fresh), user: fresh.toPublicJSON() });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/auth/2fa/backup-codes { code } — replace all backup codes. */
router.post("/2fa/backup-codes", requireAuth, async (req, res, next) => {
  try {
    const user = await loadWithSecrets(req.user._id);
    const result = await regenerateBackupCodes(user, req.body?.code);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await recordAdminAudit({ actor: user, action: "2fa-backup-codes" });
    return res.status(200).json({ backupCodes: result.backupCodes });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/auth/logout-all — sign out of every device (this one included)
 * by bumping the token version; every earlier JWT is refused from now on.
 */
router.post("/logout-all", requireAuth, async (req, res, next) => {
  try {
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { tokenVersion: 1 } },
      { returnDocument: "after" }
    );
    await recordAdminAudit({
      actor: updated || req.user,
      action: "sign-out-all",
      meta: { role: req.user.role },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
