import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import queueRoutes from "./routes/queues.js";
import { parseClientOrigins } from "./corsOrigin.js";

/** Default JSON body cap — enough for queue APIs, small enough to blunt abuse. */
export const JSON_BODY_LIMIT = "16kb";

const DEFAULT_AUTH_RATE = { windowMs: 15 * 60 * 1000, max: 20 };
const DEFAULT_JOIN_RATE = { windowMs: 15 * 60 * 1000, max: 30 };

function tooManyAttempts(req, res, _next, options) {
  res.status(options.statusCode).json({ error: "Too many attempts, try again later" });
}

function buildLimiter(kind, defaults, override) {
  const windowMs = override?.windowMs ?? defaults.windowMs;
  const max = override?.max ?? defaults.max;
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: tooManyAttempts,
  });
}

/**
 * Build the Express application (no listen).
 * Exporting createApp keeps the HTTP surface testable without binding a port.
 * Callers are responsible for connecting MongoDB before handling requests.
 *
 * CORS: set CLIENT_ORIGIN to the deployed frontend origin (or a comma-separated
 * list). Local default is Vite at http://localhost:5173.
 *
 * Rate limits (auth login/register, queue join) can be disabled or tightened
 * via options for tests. They are keyed by client IP (no trust proxy by default).
 *
 * @param {{
 *   clientOrigin?: string | string[] | boolean,
 *   jsonLimit?: string | number,
 *   rateLimit?: false,
 *   authRateLimit?: { windowMs?: number, max?: number },
 *   joinRateLimit?: { windowMs?: number, max?: number },
 * }} [options]
 */
export function createApp(options = {}) {
  const app = express();
  const clientOrigin =
    options.clientOrigin !== undefined
      ? options.clientOrigin
      : parseClientOrigins(process.env.CLIENT_ORIGIN);

  app.use(
    helmet({
      // Default CORP is same-origin, which can block a separately hosted
      // frontend (Vite / Vercel) from reading API responses. CORS still
      // governs which origins may call the API.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(
    cors({
      origin: clientOrigin,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Guest-Credential"],
    })
  );
  app.use(express.json({ limit: options.jsonLimit ?? JSON_BODY_LIMIT }));

  if (options.rateLimit !== false) {
    const authLimiter = buildLimiter("auth", DEFAULT_AUTH_RATE, options.authRateLimit);
    const joinLimiter = buildLimiter("join", DEFAULT_JOIN_RATE, options.joinRateLimit);
    app.post("/api/auth/register", authLimiter);
    app.post("/api/auth/login", authLimiter);
    app.post("/api/auth/forgot-password", authLimiter);
    app.post("/api/auth/reset-password", authLimiter);
    app.use("/api/queues", (req, res, next) => {
      if (req.method === "POST" && /\/join\/?$/.test(req.path)) {
        return joinLimiter(req, res, next);
      }
      return next();
    });
  }

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
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
