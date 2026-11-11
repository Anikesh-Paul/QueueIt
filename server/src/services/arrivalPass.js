import crypto from "node:crypto";

/**
 * Arrival pass — the QR payload shown at the counter and matched by an admin.
 *
 * A pass confirms that a token is waiting in a queue. It is a counter
 * convenience, not proof of identity.
 *
 * Formats:
 *   `QIT:<queueId>:<tokenNumber>:<mac>`  — signed pass issued at join/status
 *   `QIT:<queueId>:<tokenNumber>`        — legacy unsigned pass (rejected by default)
 *   a bare token number                  — manual counter entry (rejected by default)
 *
 * The MAC is HMAC-SHA256 of `QIT:<queueId>:<tokenNumber>`, truncated, keyed by
 * `ARRIVAL_PASS_SECRET` or `JWT_SECRET`. A present but invalid MAC is rejected.
 * Unsigned and bare values are only accepted when ALLOW_UNSIGNED_ARRIVAL is
 * set to 1/true (documented escape hatch; default off).
 */
export const ARRIVAL_PASS_PREFIX = "QIT:";
/** Hex length of the truncated HMAC (10 bytes). */
export const ARRIVAL_MAC_LENGTH = 20;

function arrivalBase(queueId, tokenNumber) {
  return `${ARRIVAL_PASS_PREFIX}${queueId}:${tokenNumber}`;
}

export function getArrivalPassSecret() {
  return process.env.ARRIVAL_PASS_SECRET || process.env.JWT_SECRET || "";
}

/**
 * Escape hatch for venues that still need typed token numbers or leftover
 * unsigned QIT: passes. Default is off. Accepts 1/true/yes (case-insensitive).
 */
export function unsignedArrivalAllowed(env = process.env) {
  const raw = String(env.ALLOW_UNSIGNED_ARRIVAL || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export const UNSIGNED_ARRIVAL_REASON =
  "This check only accepts a signed arrival pass. Scan the student's QR.";

/**
 * Decide whether a parsed pass may proceed to waiting-list matching.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function arrivalVerifyDecision(parsed, { allowUnsigned = unsignedArrivalAllowed() } = {}) {
  if (!parsed) {
    return { ok: false, reason: "That doesn't look like a valid pass or token number" };
  }
  if (parsed.invalidSignature) {
    return { ok: false, reason: "This pass is not valid" };
  }
  if (!parsed.signed && !allowUnsigned) {
    return { ok: false, reason: UNSIGNED_ARRIVAL_REASON };
  }
  return { ok: true };
}

function computeMac(base) {
  const secret = getArrivalPassSecret();
  if (!secret) {
    throw new Error("JWT_SECRET or ARRIVAL_PASS_SECRET is required to sign arrival passes");
  }
  return crypto.createHmac("sha256", secret).update(base).digest("hex").slice(0, ARRIVAL_MAC_LENGTH);
}

function macsEqual(presented, expected) {
  const left = Buffer.from(String(presented), "utf8");
  const right = Buffer.from(String(expected), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Issue a signed pass for a waiting membership. */
export function signArrivalPass(queueId, tokenNumber) {
  const base = arrivalBase(String(queueId), Number(tokenNumber));
  return `${base}:${computeMac(base)}`;
}

/**
 * Parse a counter input into { queueId, tokenNumber, signed }.
 * A fourth-segment pass with a bad MAC returns { invalidSignature: true }.
 * @param {string} value
 * @returns {{ queueId?: string, tokenNumber?: number, signed?: boolean, invalidSignature?: boolean } | null}
 */
export function parseArrivalValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(ARRIVAL_PASS_PREFIX)) {
    const parts = trimmed.slice(ARRIVAL_PASS_PREFIX.length).split(":");
    if (parts.length !== 2 && parts.length !== 3) return null;
    const [queueId, rawToken, mac] = parts;
    if (!queueId || !rawToken) return null;
    if (!/^[0-9a-f]{24}$/i.test(queueId)) return null;
    const tokenNumber = parseTokenNumber(rawToken);
    if (tokenNumber === null) return null;

    if (parts.length === 3) {
      if (!mac || !/^[0-9a-f]+$/i.test(mac) || mac.length !== ARRIVAL_MAC_LENGTH) {
        return { invalidSignature: true };
      }
      const expected = computeMac(arrivalBase(queueId, tokenNumber));
      if (!macsEqual(mac.toLowerCase(), expected)) {
        return { invalidSignature: true };
      }
      return { queueId, tokenNumber, signed: true };
    }

    return { queueId, tokenNumber, signed: false };
  }

  const tokenNumber = parseTokenNumber(trimmed);
  if (tokenNumber === null) return null;
  return { tokenNumber, signed: false };
}

/** Plain base-10 digits only — no hex ("0x10"), exponent ("1e3"), or floats. */
function parseTokenNumber(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return value;
}
