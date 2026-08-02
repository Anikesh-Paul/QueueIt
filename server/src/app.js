import express from "express";
import cors from "cors";

/**
 * Build the Express application (no listen).
 * Exporting createApp keeps the HTTP surface testable without binding a port.
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

  return app;
}
