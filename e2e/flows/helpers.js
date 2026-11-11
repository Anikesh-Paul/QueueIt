import fs from "node:fs";
import path from "node:path";

export const API = process.env.E2E_API_URL || "http://localhost:5000";

export function tokens() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "e2e", ".auth", "tokens.json"), "utf8"));
}

/** Start the page already signed in (and optionally in a theme). */
export async function signIn(page, token, { theme } = {}) {
  await page.addInitScript(
    ([t, th]) => {
      if (t) window.localStorage.setItem("queueit_token", t);
      if (th) window.localStorage.setItem("queueit_theme", th);
    },
    [token || null, theme || null]
  );
}

export async function queueByName(request, name) {
  const res = await request.get(`${API}/api/queues`);
  const body = await res.json();
  const queue = body.queues.find((q) => q.name === name);
  if (!queue) throw new Error(`queue ${name} not seeded`);
  return queue;
}

/** Register a throwaway student via the API and return its token. */
export async function registerStudent(request, label) {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await request.post(`${API}/api/auth/register`, {
    data: { email, password: "password123", name: `E2E ${label}` },
  });
  if (!res.ok()) throw new Error(`register failed ${res.status()} ${await res.text()}`);
  return (await res.json()).token;
}

/** Make sure a queue is open and taking tokens (admin API). */
export async function ensureOpen(request, adminToken, queueId) {
  const headers = { Authorization: `Bearer ${adminToken}` };
  await request.post(`${API}/api/admin/queues/${queueId}/resume`, { headers });
  await request.post(`${API}/api/admin/queues/${queueId}/start-accepting`, { headers });
  await request.patch(`${API}/api/admin/queues/${queueId}`, { headers, data: { guestJoin: true } });
}
