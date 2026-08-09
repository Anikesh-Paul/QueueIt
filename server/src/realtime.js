import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { getJwtSecret } from "./middleware/auth.js";
import { Queue } from "./models/Queue.js";
import { QueueEntry, ACTIVE_ENTRY_STATUSES } from "./models/QueueEntry.js";
import { attachRealtime, roomForQueue } from "./services/realtime.js";

/**
 * Attach the Socket.IO realtime server to an existing HTTP server.
 *
 * Long-running hosts only (local dev, Render, Node hosts). The Vercel
 * serverless entry (`api/index.js`) deliberately does NOT attach sockets —
 * persistent connections are unsupported there, and the client falls back to
 * its polling path when the socket cannot connect.
 *
 * Connection contract:
 * - `auth: { token }` carries the session JWT (rejected when missing/invalid)
 * - `subscribe { queueId }` joins the queue room; users must hold an active
 *   membership in that queue, admins may subscribe to any queue
 * - `unsubscribe { queueId }` leaves the room
 *
 * Mutations broadcast `queue:changed { queueId, change }` to the queue room
 * (see services/realtime.js); subscribers re-fetch through the normal REST
 * APIs, so the socket never bypasses the tested HTTP surface.
 *
 * @param {import("node:http").Server} httpServer
 * @param {{ clientOrigin?: string | string[] | boolean }} [options]
 */
export function createRealtimeServer(httpServer, options = {}) {
  const io = new Server(httpServer, {
    serveClient: false,
    cors: {
      origin: options.clientOrigin ?? true,
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    let payload;
    try {
      payload = jwt.verify(token, getJwtSecret());
    } catch {
      return next(new Error("Invalid or expired token"));
    }

    socket.data.user = { sub: payload.sub, role: payload.role };
    return next();
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", async (data, ack) => {
      try {
        const queueId = data?.queueId;
        if (!queueId || !mongoose.isValidObjectId(queueId)) {
          return ack?.({ ok: false, error: "Invalid queue id" });
        }

        const queue = await Queue.findById(queueId);
        if (!queue) {
          return ack?.({ ok: false, error: "Queue not found" });
        }

        const user = socket.data.user;
        if (user.role !== "admin") {
          const entry = await QueueEntry.findOne({
            queue: queueId,
            user: user.sub,
            status: { $in: ACTIVE_ENTRY_STATUSES },
          });
          if (!entry) {
            return ack?.({ ok: false, error: "Not in this queue" });
          }
        }

        await socket.join(roomForQueue(queueId));
        return ack?.({ ok: true });
      } catch {
        return ack?.({ ok: false, error: "Subscription failed" });
      }
    });

    socket.on("unsubscribe", (data, ack) => {
      const queueId = data?.queueId;
      if (queueId) {
        socket.leave(roomForQueue(queueId));
      }
      return ack?.({ ok: true });
    });
  });

  attachRealtime(io);
  return io;
}
