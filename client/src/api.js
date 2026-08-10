export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

/**
 * Low-level JSON fetch against the QueueIt API.
 * JWT (token) wins over Guest credential when both are set.
 * @param {string} path
 * @param {{ method?: string, body?: unknown, token?: string | null, guestCredential?: string | null }} [options]
 */
export async function apiRequest(path, options = {}) {
  const { method = "GET", body, token, guestCredential } = options;
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (guestCredential) {
    headers["X-Guest-Credential"] = guestCredential;
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

/**
 * POST /api/auth/register — optional Guest credential triggers soft upgrade (claim + retire).
 * @param {{ email: string, password: string, name?: string, guestCredential?: string | null }}
 */
export function register({ email, password, name, guestCredential }) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: { email, password, name },
    guestCredential: guestCredential || null,
  });
}

/**
 * POST /api/auth/login — optional Guest credential triggers soft upgrade (claim + retire).
 * @param {{ email: string, password: string, guestCredential?: string | null }}
 */
export function login({ email, password, guestCredential }) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: { email, password },
    guestCredential: guestCredential || null,
  });
}

export function fetchMe(token) {
  return apiRequest("/api/auth/me", { token });
}

export function adminPing(token) {
  return apiRequest("/api/admin/ping", { token });
}

/** GET /api/queues — public catalog (User JWT or Guest credential optional). */
export function fetchQueues(token, guestCredential) {
  return apiRequest("/api/queues", { token, guestCredential });
}

/** POST /api/queues/:queueId/join — take a place; Guest mints credential on first join. */
export function joinQueue(token, queueId, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/join`, {
    method: "POST",
    token,
    guestCredential,
  });
}

/** GET /api/queues/:queueId/status — poll token, position, ETA, now serving. */
export function fetchQueueStatus(token, queueId, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/status`, {
    token,
    guestCredential,
  });
}

/** POST /api/queues/:queueId/leave — free the caller's active place in line. */
export function leaveQueue(token, queueId, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/leave`, {
    method: "POST",
    token,
    guestCredential,
  });
}

/** GET /api/queues/history — User History or Guest device-local history. */
export function fetchHistory(token, guestCredential) {
  return apiRequest("/api/queues/history", { token, guestCredential });
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
 * POST /api/admin/queues/:queueId/stop-accepting
 * Sets Closed: refuse new app tokens; drain waiting list. Not Pause / not Reset.
 * Optional body: { reopenAt: ISO string } to override default next-window reopen.
 */
export function stopAcceptingTokens(token, queueId, { reopenAt } = {}) {
  const body = {};
  if (reopenAt != null && reopenAt !== "") body.reopenAt = reopenAt;
  return apiRequest(`/api/admin/queues/${queueId}/stop-accepting`, {
    method: "POST",
    token,
    body: Object.keys(body).length ? body : undefined,
  });
}

/**
 * POST /api/admin/queues/:queueId/start-accepting
 * Leaves Closed and begins issuing tokens (binds target service window).
 */
export function startAcceptingTokens(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/start-accepting`, {
    method: "POST",
    token,
  });
}

/**
 * POST /api/admin/queues/:queueId/extend
 * Push auto-close end while accepting. Body: { minutes: 15|30 } or { endsAt: ISO }.
 */
export function extendAcceptingSession(token, queueId, payload) {
  return apiRequest(`/api/admin/queues/${queueId}/extend`, {
    method: "POST",
    token,
    body: payload,
  });
}

/**
 * POST /api/admin/queues/:queueId/reset
 * End-of-session / day close: clears waiting list, resets tokens + now serving,
 * re-opens advancement. Does not flip accepting tokens.
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
