/**
 * Arrival pass — the QR payload shown by a user at the counter and matched by
 * an admin. Compact and scannable; the admin console also accepts a bare token
 * number typed at the counter, so the full payload is only needed when a
 * scanner is in play.
 *
 * Format: `QIT:<queueId>:<tokenNumber>` (e.g. `QIT:5f0c…:7`).
 * The client builds it from the live status; the server parses + validates it.
 */
export const ARRIVAL_PASS_PREFIX = "QIT:";

/** Build the pass string exactly as the client ships it. */
export function buildArrivalPass(queueId, tokenNumber) {
  return `${ARRIVAL_PASS_PREFIX}${queueId}:${tokenNumber}`;
}

/**
 * Parse a counter input into { queueId, tokenNumber }.
 * Accepts a full pass (`QIT:<queueId>:<tokenNumber>`) or a bare token number
 * (the QR is scoped to the queue whose console the admin opened).
 * @param {string} value
 * @returns {{ queueId?: string, tokenNumber?: number } | null}
 */
export function parseArrivalValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(ARRIVAL_PASS_PREFIX)) {
    const [queueId, rawToken] = trimmed.slice(ARRIVAL_PASS_PREFIX.length).split(":");
    if (!queueId || !rawToken) return null;
    if (!/^[0-9a-f]{24}$/i.test(queueId)) return null;
    const tokenNumber = Number(rawToken);
    if (!Number.isInteger(tokenNumber) || tokenNumber < 1) return null;
    return { queueId, tokenNumber };
  }

  const tokenNumber = Number(trimmed);
  if (!Number.isInteger(tokenNumber) || tokenNumber < 1) return null;
  return { tokenNumber };
}
