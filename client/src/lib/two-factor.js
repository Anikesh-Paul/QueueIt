/** Small helpers for the two-step sign-in screens (pure; unit-tested). */

/** Strip spaces/dashes a person may type or paste around a 6-digit code. */
export function cleanCode(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

/** A full authenticator code: exactly six digits. */
export function isAuthenticatorCode(value) {
  return /^\d{6}$/.test(cleanCode(value));
}

/** Backup codes look like "k3f9q-7xm2p" (10 letters/digits, dash optional). */
export function isBackupCode(value) {
  return /^[a-z0-9]{10}$/i.test(String(value ?? "").replace(/[\s-]/g, ""));
}

/** What the sign-in code field accepts in each mode. */
export function codeLooksComplete(value, mode = "app") {
  return mode === "backup" ? isBackupCode(value) : isAuthenticatorCode(value);
}

/** "JBSWY3DPEHPK3PXP…" → "JBSW Y3DP EHPK 3PXP …" for typing into an app by hand. */
export function groupSecret(secret, size = 4) {
  const clean = String(secret ?? "").replace(/\s+/g, "").toUpperCase();
  const groups = [];
  for (let i = 0; i < clean.length; i += size) groups.push(clean.slice(i, i + size));
  return groups.join(" ");
}

/** Plain-text file body for "Download backup codes". */
export function backupCodesFile(codes, { email = "", issuedAt = new Date() } = {}) {
  const lines = [
    "QueueIt backup codes",
    email ? `Account: ${email}` : null,
    `Created: ${issuedAt.toISOString().slice(0, 10)}`,
    "",
    "Each code works once. Keep them somewhere safe and private.",
    "",
    ...(codes || []).map((code, i) => `${String(i + 1).padStart(2, " ")}. ${code}`),
    "",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/** Login response → which step comes next. */
export function loginOutcome(data) {
  if (data?.twoFactorRequired && data.challenge) return { step: "code", challenge: data.challenge };
  if (data?.token) return { step: "done" };
  return { step: "error" };
}
