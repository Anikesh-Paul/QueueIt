const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

/**
 * Low-level JSON fetch against the QueueIt API.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, token?: string | null }} [options]
 */
export async function apiRequest(path, options = {}) {
  const { method = "GET", body, token } = options;
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function register({ email, password, name }) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: { email, password, name },
  });
}

export function login({ email, password }) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function fetchMe(token) {
  return apiRequest("/api/auth/me", { token });
}

export function adminPing(token) {
  return apiRequest("/api/admin/ping", { token });
}

/** GET /api/queues — authenticated catalog of available queues. */
export function fetchQueues(token) {
  return apiRequest("/api/queues", { token });
}

/** POST /api/queues/:queueId/join — take a place; receive token + live status. */
export function joinQueue(token, queueId) {
  return apiRequest(`/api/queues/${queueId}/join`, {
    method: "POST",
    token,
  });
}

/** GET /api/queues/:queueId/status — poll token, position, ETA, now serving. */
export function fetchQueueStatus(token, queueId) {
  return apiRequest(`/api/queues/${queueId}/status`, { token });
}
