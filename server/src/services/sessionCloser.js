/**
 * Punctual auto-close for long-running Node hosts.
 *
 * HTTP paths already call ensureQueueSessionState lazily. This ticker closes
 * queues whose sessionEndsAt has passed even when no client has hit the API.
 * The Vercel serverless entry does not start this interval — those hosts still
 * rely on lazy close (or an external cron) for punctuality.
 */
import { Queue } from "../models/Queue.js";
import { now as clockNow } from "./clock.js";
import { ensureQueueSessionState } from "./queueSession.js";
import { expireNoShowCalls } from "./servingDeadline.js";

/** Default tick: close within 15s of session end when the process is running. */
export const DEFAULT_SESSION_CLOSE_INTERVAL_MS = 15_000;

let inFlight = false;

/**
 * Close every accepting queue whose bound session end is at or before now.
 * Safe to call from tests (uses the clock seam) and from the interval.
 * @returns {Promise<number>} how many queues were auto-closed this tick
 */
export async function closeExpiredSessions() {
  if (inFlight) return 0;
  inFlight = true;
  try {
    await expireNoShowCalls();
    const instant = clockNow();
    const queues = await Queue.find({
      acceptingTokens: { $ne: false },
      sessionEndsAt: { $ne: null, $lte: instant },
    });

    let closed = 0;
    for (const queue of queues) {
      const didClose = await ensureQueueSessionState(queue);
      if (didClose) closed += 1;
    }
    return closed;
  } finally {
    inFlight = false;
  }
}

function resolveIntervalMs(override) {
  if (override != null) return Number(override);
  const fromEnv = Number(process.env.SESSION_CLOSE_INTERVAL_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 1_000) return fromEnv;
  return DEFAULT_SESSION_CLOSE_INTERVAL_MS;
}

/**
 * Start the punctual closer. Returns a stop function.
 * @param {{ intervalMs?: number, unref?: boolean }} [options]
 */
export function startSessionCloser(options = {}) {
  const intervalMs = resolveIntervalMs(options.intervalMs);
  const timer = setInterval(() => {
    closeExpiredSessions().catch((err) => {
      console.error("session closer failed:", err);
    });
  }, intervalMs);
  if (options.unref) timer.unref();
  return () => clearInterval(timer);
}
