import crypto from "crypto";

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits) — the defaults every
 * authenticator app (Google Authenticator, Microsoft Authenticator, Authy,
 * 1Password…) understands. No third-party dependency.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next 30 s step for phone clock drift. */
export const TOTP_DRIFT_STEPS = 1;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit random secret, base32 (what the QR code / manual key carries). */
export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpStep(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpCode(secretBase32, atMs = Date.now()) {
  return hotp(secretBase32, totpStep(atMs));
}

export function normalizeTotpInput(code) {
  return String(code ?? "").replace(/[\s-]/g, "");
}

/**
 * Check a 6-digit code. Returns the matched step (for replay protection) or
 * null. Codes at or before `afterStep` are refused (already used).
 */
export function verifyTotp(secretBase32, code, { atMs = Date.now(), afterStep = null, drift = TOTP_DRIFT_STEPS } = {}) {
  const input = normalizeTotpInput(code);
  if (!/^\d{6}$/.test(input) || !secretBase32) return null;
  const current = totpStep(atMs);
  for (let delta = -drift; delta <= drift; delta += 1) {
    const step = current + delta;
    if (afterStep != null && step <= afterStep) continue;
    const expected = hotp(secretBase32, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input))) return step;
  }
  return null;
}

/** otpauth:// URI for the enrollment QR code. */
export function otpauthUrl({ secret, account, issuer = "QueueIt" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
