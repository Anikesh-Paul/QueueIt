import { io } from "socket.io-client";

/**
 * QueueIt realtime client (Socket.IO).
 *
 * Thin wrapper around socket.io-client: connects with the session JWT,
 * subscribes/unsubscribes queue rooms, and reports queue:changed notifications
 * plus connection state. Any failure is non-fatal — callers keep their polling
 * fallback, so a dead socket only degrades latency, never liveness. On hosts
 * without a persistent socket endpoint (e.g. Vercel serverless) the connection
 * simply fails and the app keeps working on polling.
 *
 * @param {{
 *   url: string,
 *   token: string,
 *   onQueueChanged?: (payload: { queueId: string, change: string }) => void,
 *   onStatusChange?: (connected: boolean) => void,
 * }} options
 */
export function createRealtimeClient({ url, token, onQueueChanged, onStatusChange }) {
  const socket = io(url, {
    autoConnect: false,
    reconnection: true,
    // Bounded backoff: recover from transient blips locally/on Render without
    // hammering hosts that cannot hold sockets (e.g. Vercel serverless).
    reconnectionDelay: 2000,
    reconnectionDelayMax: 8000,
    randomizationFactor: 0.5,
    transports: ["websocket", "polling"],
    auth: { token },
  });

  /** Queue ids currently subscribed to on the server. */
  let subscribed = new Set();

  function subscribeTo(queueId) {
    socket.emit("subscribe", { queueId }, (ack) => {
      // A connected socket that cannot join a room is not serving the surface —
      // the honest indicator stays on the polling fallback.
      if (ack && ack.ok === false && subscribed.has(queueId)) {
        onStatusChange?.(false);
      }
    });
  }

  function resubscribeAll() {
    for (const queueId of subscribed) {
      subscribeTo(queueId);
    }
  }

  socket.on("connect", () => {
    resubscribeAll();
    onStatusChange?.(true);
  });
  socket.on("disconnect", () => onStatusChange?.(false));
  socket.on("connect_error", () => onStatusChange?.(false));
  socket.on("queue:changed", (payload) => onQueueChanged?.(payload));

  return {
    connect() {
      socket.connect();
    },
    disconnect() {
      socket.disconnect();
    },
    /**
     * Subscribe to exactly the given queue rooms (diff-based; re-sends on
     * reconnect). Unrelated rooms are left untouched, so a user status room
     * survives an admin console visit in the same session.
     * @param {string[]} queueIds
     */
    setSubscriptions(queueIds) {
      const next = new Set(queueIds);
      for (const queueId of next) {
        if (!subscribed.has(queueId)) {
          subscribeTo(queueId);
        }
      }
      for (const queueId of subscribed) {
        if (!next.has(queueId)) {
          socket.emit("unsubscribe", { queueId });
        }
      }
      subscribed = next;
    },
  };
}
