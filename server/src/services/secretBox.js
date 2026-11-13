import crypto from "crypto";

/**
 * AES-256-GCM for small secrets at rest (TOTP seeds).
 * Key: TOTP_ENCRYPTION_KEY when set, otherwise derived (HKDF-SHA256) from
 * JWT_SECRET so no new configuration is needed. Format: v1.<iv>.<tag>.<ct>
 * (base64url). Rotating the key source makes stored seeds unreadable; those
 * accounts then sign in with a backup code and enroll again.
 */
const VERSION = "v1";

export function secretBoxKey(env = process.env) {
  const dedicated = String(env.TOTP_ENCRYPTION_KEY || "").trim();
  if (dedicated) {
    return Buffer.from(crypto.hkdfSync("sha256", dedicated, "queueit-totp", "totp-secret-v1", 32));
  }
  const jwtSecret = String(env.JWT_SECRET || "");
  if (!jwtSecret) throw new Error("JWT_SECRET is required to protect two-step secrets");
  return Buffer.from(crypto.hkdfSync("sha256", jwtSecret, "queueit-totp", "totp-secret-v1", 32));
}

export function sealSecret(plain, key = secretBoxKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Returns the plain text, or null when the box was tampered with or the key changed. */
export function openSecret(sealed, key = secretBoxKey()) {
  if (typeof sealed !== "string") return null;
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ct) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
