import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Log the seeded demo accounts in once per run and share the tokens with the
 * flow specs (keeps us well under the auth rate limit on a reused server).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(here, ".auth", "tokens.json");
const API = process.env.E2E_API_URL || "http://localhost:5000";

async function login(email, password) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`e2e login failed for ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

export default async function globalSetup() {
  const admin = await login(process.env.SEED_ADMIN_EMAIL || "admin@queueit.local", process.env.SEED_ADMIN_PASSWORD || "admin-demo-pass");
  const student = await login(process.env.SEED_USER_EMAIL || "user@queueit.local", process.env.SEED_USER_PASSWORD || "user-demo-pass");
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ admin, student }));
}
