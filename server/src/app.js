import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import queueRoutes from "./routes/queues.js";

/**
 * Build the Express application (no listen).
 * Exporting createApp keeps the HTTP surface testable without binding a port.
 * Callers are responsible for connecting MongoDB before handling requests.
 */
export function createApp(options = {}) {
  const app = express();
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

  app.use(cors({ origin: clientOrigin }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "queueit-server",
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/queues", queueRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
