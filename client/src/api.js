export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

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

/** POST /api/queues/:queueId/leave — free the caller's active place in line. */
export function leaveQueue(token, queueId) {
  return apiRequest(`/api/queues/${queueId}/leave`, {
    method: "POST",
    token,
  });
}

/** GET /api/queues/history — caller's queue events (joined / left / served / skipped). */
export function fetchHistory(token) {
  return apiRequest("/api/queues/history", { token });
}

/** GET /api/admin/queues/:queueId/waiting-list — admin waiting list + queue meta. */
export function fetchWaitingList(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/waiting-list`, { token });
}

/**
 * GET /api/admin/queues/:queueId/analytics
 * Ops metrics: served count, average wait, simple peaks (busiest hours).
 */
export function fetchAnalytics(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/analytics`, { token });
}

/** POST /api/admin/queues/:queueId/serve — serve next or selected waiting entry. */
export function serveQueue(token, queueId, entryId) {
  return apiRequest(`/api/admin/queues/${queueId}/serve`, {
    method: "POST",
    token,
    body: entryId ? { entryId } : {},
  });
}

/** POST /api/admin/queues/:queueId/skip — skip next or selected waiting entry. */
export function skipQueue(token, queueId, entryId) {
  return apiRequest(`/api/admin/queues/${queueId}/skip`, {
    method: "POST",
    token,
    body: entryId ? { entryId } : {},
  });
}

/** POST /api/admin/queues/:queueId/pause */
export function pauseQueue(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/pause`, {
    method: "POST",
    token,
  });
}

/** POST /api/admin/queues/:queueId/resume */
export function resumeQueue(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/resume`, {
    method: "POST",
    token,
  });
}

/**
 * POST /api/admin/queues/:queueId/reset
 * End-of-session / day close: clears waiting list, resets tokens + now serving,
 * re-opens the queue.
 */
export function resetQueue(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/reset`, {
    method: "POST",
    token,
  });
}

/**
 * POST /api/admin/queues/:queueId/walk-in
 * Counter walk-in: { name, tokenNumber? } — auto token when tokenNumber omitted.
 */
export function walkInQueue(token, queueId, { name, tokenNumber } = {}) {
  const body = { name };
  if (tokenNumber !== undefined && tokenNumber !== null && tokenNumber !== "") {
    body.tokenNumber = Number(tokenNumber);
  }
  return apiRequest(`/api/admin/queues/${queueId}/walk-in`, {
    method: "POST",
    token,
    body,
  });
}

/**
 * POST /api/admin/queues/:queueId/verify-qr
 * Counter arrival check: match a QR pass or bare token against the waiting
 * list. Resolves to { verified, entry?, reason? } — a non-match is a valid
 * counter outcome, not an error.
 */
export function verifyArrival(token, queueId, value) {
  return apiRequest(`/api/admin/queues/${queueId}/verify-qr`, {
    method: "POST",
    token,
    body: { value },
  });
}
