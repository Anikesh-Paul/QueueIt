import mongoose from "mongoose";

/**
 * Failed sign-in counters shared by every API instance (serverless-safe).
 * `key` is a hash of the account email or client IP — never the raw value.
 * Documents expire on their own shortly after the window or lock ends.
 */
const loginThrottleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    scope: { type: String, enum: ["account", "ip"], required: true },
    count: { type: Number, default: 0 },
    windowStart: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);

loginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginThrottle =
  mongoose.models.LoginThrottle || mongoose.model("LoginThrottle", loginThrottleSchema);
