/**
 * Arrival pass — the QR payload a user shows at the counter (see server
 * `services/arrivalPass.js` for the matching parser + format rules).
 *
 * Prefer the signed `arrivalPass` issued on join/status. This helper is a
 * legacy unsigned fallback only. A scan confirms the token is waiting; it is
 * not proof of identity.
 *
 * Formats: `QIT:<queueId>:<tokenNumber>:<mac>` (signed) or
 * `QIT:<queueId>:<tokenNumber>` (unsigned).
 */
export function buildArrivalPass(queueId, tokenNumber) {
  return `QIT:${queueId}:${tokenNumber}`;
}

/** Use the server-issued signed pass when present, otherwise the unsigned fallback. */
export function resolveArrivalPass({ arrivalPass, queueId, tokenNumber }) {
  if (typeof arrivalPass === "string" && arrivalPass.startsWith("QIT:")) {
    return arrivalPass;
  }
  return buildArrivalPass(queueId, tokenNumber);
}
