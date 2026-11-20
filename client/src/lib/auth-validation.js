/**
 * Client-side checks for the sign-in forms. They only decide which hint to
 * show next to a field; the server stays the source of truth. Each check
 * returns an i18n key (or "" when the value is fine).
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Loose on purpose: one @, something on both sides, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value) {
  const v = String(value ?? "").trim();
  if (!v) return "auth.emailRequired";
  if (v.length > 254 || !EMAIL_RE.test(v)) return "auth.emailInvalid";
  return "";
}

/** Login only needs something typed; register and reset enforce the length rules. */
export function passwordError(value, { mode = "login" } = {}) {
  const v = String(value ?? "");
  if (!v) return "auth.passwordRequired";
  if (mode === "login") return v.length > PASSWORD_MAX ? "auth.passwordLong" : "";
  if (v.length < PASSWORD_MIN) return "auth.passwordShort";
  if (v.length > PASSWORD_MAX) return "auth.passwordLong";
  return "";
}

export function nameError(value) {
  return String(value ?? "").trim() ? "" : "auth.nameRequired";
}

export function confirmError(password, confirm) {
  if (!String(confirm ?? "")) return "auth.passwordRequired";
  return password === confirm ? "" : "reset.mismatch";
}

/** Errors for every field of a form; empty object means OK to submit. */
export function validateAuthForm({ mode, name, email, password }) {
  const errors = {};
  if (mode === "register") {
    const n = nameError(name);
    if (n) errors.name = n;
  }
  const e = emailError(email);
  if (e) errors.email = e;
  const p = passwordError(password, { mode });
  if (p) errors.password = p;
  return errors;
}

/** Messages the API sends in English, mapped to translated copy. */
const SERVER_MESSAGES = {
  "Invalid email or password": "auth.invalidLogin",
  "Email already registered": "auth.emailTaken",
  "Enter a valid email address": "auth.emailInvalid",
  "Email and password are required": "auth.missingFields",
  "Password must be at most 128 characters": "auth.passwordLong",
  "Your sign-in timed out. Enter your email and password again.": "auth.challengeExpired",
  "Too many attempts, try again later": "auth.lockedBody",
};

/**
 * Turn an API error into { kind, key, message } for the error alert.
 * kind "locked" (429), "offline", or "error". `key` is an i18n key when the
 * message is one we know; otherwise `message` carries the server text.
 */
export function describeAuthError(err) {
  if (!err) return null;
  if (err.offline) return { kind: "offline", key: "offline.generic", message: "" };
  if (err.status === 429) return { kind: "locked", key: "auth.lockedBody", message: "" };
  const key = SERVER_MESSAGES[String(err.message || "").trim()];
  if (key) return { kind: "error", key, message: "" };
  return { kind: "error", key: err.message ? "" : "auth.requestFailed", message: err.message || "" };
}

/** Browsers report Caps Lock on keyboard events; anything else says "unknown" (false). */
export function capsLockOn(event) {
  return typeof event?.getModifierState === "function" ? Boolean(event.getModifierState("CapsLock")) : false;
}
