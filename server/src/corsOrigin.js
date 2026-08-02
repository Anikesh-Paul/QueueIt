/**
 * Parse CLIENT_ORIGIN (or equivalent) into a CORS origin setting.
 *
 * Supports:
 * - single origin: "https://app.example.com"
 * - comma-separated list: "https://a.com,https://b.com"
 * - "*" (reflect any origin — avoid in production demos with credentials)
 *
 * In production (NODE_ENV=production), an empty CLIENT_ORIGIN fails closed
 * (no browser origins allowed) so a misconfigured deploy cannot silently
 * fall back to localhost. Local/dev still defaults to Vite.
 *
 * Returns a value suitable for the `cors` package `origin` option:
 * string | string[] | boolean | function.
 *
 * @param {string | undefined} raw
 * @param {{ nodeEnv?: string, fallback?: string }} [options]
 */
export function parseClientOrigins(raw, options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const fallback = options.fallback ?? "http://localhost:5173";
  const value = (raw ?? "").trim();

  if (!value) {
    if (nodeEnv === "production") {
      // Deny all browser origins until CLIENT_ORIGIN is set on the host.
      return false;
    }
    return fallback;
  }
  if (value === "*") {
    return true;
  }

  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\/$/, ""));

  if (list.length === 0) {
    if (nodeEnv === "production") {
      return false;
    }
    return fallback;
  }
  if (list.length === 1) {
    return list[0];
  }
  return list;
}
