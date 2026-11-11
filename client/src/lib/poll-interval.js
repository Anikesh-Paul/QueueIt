/**
 * Live-status and admin waiting-list poll cadence.
 *
 * Visible + no socket: 3s (honest fallback).
 * Visible + Socket.IO connected: 15s (socket is the fast path).
 * Hidden tab: do not poll; resume when the tab is visible again.
 */
export const STATUS_POLL_VISIBLE_MS = 3_000;
export const STATUS_POLL_SOCKET_MS = 15_000;

/**
 * @param {{ hidden?: boolean, realtimeConnected?: boolean }} [opts]
 * @returns {number | null} interval ms, or null to pause
 */
export function resolveStatusPollMs(opts = {}) {
  if (opts.hidden) return null;
  if (opts.realtimeConnected) return STATUS_POLL_SOCKET_MS;
  return STATUS_POLL_VISIBLE_MS;
}
