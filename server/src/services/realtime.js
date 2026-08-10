/**
 * Realtime emit registry (Socket.IO).
 *
 * Routes broadcast queue change notifications through this seam so the HTTP
 * layer stays decoupled from the socket server. Without an attached io
 * instance (e.g. the Vercel serverless entry, where persistent sockets are not
 * supported) emits are safe no-ops — the client's polling fallback covers
 * those hosts, so realtime is an accelerator, never a dependency.
 */

let io = null;

/** Register (or clear, with null) the live Socket.IO server instance. */
export function attachRealtime(ioInstance) {
  io = ioInstance || null;
}

/** Socket.IO room name for one queue's subscribers. */
export function roomForQueue(queueId) {
  return `queue:${String(queueId)}`;
}

/**
 * Push a change notification to everyone subscribed to the queue room.
 * No-op when realtime is not attached (serverless path).
 *
 * @param {import("mongoose").Types.ObjectId | string} queueId
 * @param {"join" | "leave" | "served" | "skipped" | "walk-in" | "reset" | "pause" | "resume" | "stop-accepting" | "start-accepting"} change
 */
export function emitQueueChanged(queueId, change) {
  if (!io) return;
  io.to(roomForQueue(queueId)).emit("queue:changed", {
    queueId: String(queueId),
    change,
  });
}
