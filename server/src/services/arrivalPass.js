import crypto from "node:crypto";

/**
 * Arrival pass — the QR payload shown at the counter and matched by an admin.
 *
 * A pass confirms that a token is waiting in a queue. It is a counter
 * convenience, not proof of identity. Staff may still type a bare token number.
 *
 * Formats:
 *   `QIT:<queueId>:<tokenNumber>:<mac>`  — signed pass issued at join/status
 *   `QIT:<queueId>:<tokenNumber>`        — legacy unsigned pass (still accepted)
 *   a bare token number                  — manual counter entry
 *
 * The MAC is HMAC-SHA256 of `QIT:<queueId>:<tokenNumber>`, truncated, keyed by
 * `ARRIVAL_PASS_SECRET` or `JWT_SECRET`. A present but invalid MAC is rejected.
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
