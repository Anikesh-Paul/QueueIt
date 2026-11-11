import crypto from "node:crypto";
import mongoose from "mongoose";

/**
 * Guest identity — device-bound peer on the student path.
 * Not a JWT role (roles remain user | admin). Soft upgrade retires the credential.
 *
 * The client presents the raw secret in `X-Guest-Credential`. Mongo stores only
 * a SHA-256 hex digest (`credential` when `hashed` is true). Legacy rows that
 * still hold plaintext are re-hashed on first successful lookup or at boot.
 */
const guestSchema = new mongoose.Schema(
  {
    /**
     * SHA-256 hex of the raw credential when `hashed` is true.
     * Legacy documents may still hold the raw secret until they are migrated.
     */
    credential: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /** True once `credential` is a hash, not the raw secret. */
    hashed: {
      type: Boolean,
      default: false,
    },
    /**
     * Set when soft upgrade claims this Guest onto a User.
     * Null while the Guest path is active.
     */
    retiredAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/** Mint a high-entropy opaque credential string (returned once to the device). */
guestSchema.statics.mintCredential = function mintCredential() {
  return crypto.randomBytes(32).toString("hex");
};

/** SHA-256 hex digest of a presented Guest credential. */
guestSchema.statics.hashCredential = function hashCredential(raw) {
  return crypto.createHash("sha256").update(String(raw), "utf8").digest("hex");
};

/**
 * Find a non-retired Guest by the raw credential the client presented.
 * Migrates a legacy plaintext row to a hash in place (and never matches a
 * stored hash as if it were a presented secret — that would be pass-the-hash).
 *
 * @param {string} raw
 * @returns {Promise<import("mongoose").Document | null>}
 */
guestSchema.statics.findActiveByPresentedCredential = async function findActiveByPresentedCredential(
  raw
) {
  const credential = String(raw || "").trim();
  if (!credential) return null;

  const digest = this.hashCredential(credential);
  const hashedGuest = await this.findOne({ credential: digest, hashed: true, retiredAt: null });
  if (hashedGuest) return hashedGuest;

  const legacy = await this.findOne({
    credential,
    hashed: { $ne: true },
    retiredAt: null,
  });
  if (!legacy) return null;

  legacy.credential = digest;
  legacy.hashed = true;
  await legacy.save();
  return legacy;
};

/**
 * Re-hash any leftover plaintext Guest credentials. Safe to call at boot.
 * Returns the number of documents rewritten.
 */
guestSchema.statics.migrateLegacyPlaintextCredentials = async function migrateLegacyPlaintextCredentials() {
  const legacy = await this.find({ hashed: { $ne: true } });
  let migrated = 0;
  for (const guest of legacy) {
    const raw = guest.credential;
    if (!raw) continue;
    guest.credential = this.hashCredential(raw);
    guest.hashed = true;
    await guest.save();
    migrated += 1;
  }
  return migrated;
};

export const Guest = mongoose.models.Guest || mongoose.model("Guest", guestSchema);
