/** Shared auth input rules for register and login. */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;

/** Simple address check — not a full RFC parser. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function isValidEmail(email) {
  if (!email || email.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_RE.test(email);
}

/**
 * Validate a password string. Returns an error message or null if ok.
 * @param {unknown} password
 * @returns {string | null}
 */
export function passwordError(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * Normalize a display name. Returns { ok, name, error }.
 * A trimmed name is required; it is never defaulted to "User".
 * @param {unknown} raw
 */
export function normalizeName(raw) {
  const name = String(raw || "").trim();
  if (name.length < NAME_MIN_LENGTH) {
    return { ok: false, name, error: "Name is required" };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { ok: false, name, error: "Name is too long" };
  }
  return { ok: true, name };
}
