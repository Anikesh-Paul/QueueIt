/**
 * Arrival pass — the QR payload a user shows at the counter (see server
 * `services/arrivalPass.js` for the matching parser + format rules).
 * Format: `QIT:<queueId>:<tokenNumber>`.
 */
export function buildArrivalPass(queueId, tokenNumber) {
  return `QIT:${queueId}:${tokenNumber}`;
}
