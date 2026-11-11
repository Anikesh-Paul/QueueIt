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

  if (
    res.headers.get("X-QueueIt-Cache") === "offline" &&
    data &&
    typeof data === "object"
  ) {
    Object.defineProperty(data, "_fromOfflineCache", {
      value: true,
      enumerable: false,
    });
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

export function forgotPassword({ email }) {
  return apiRequest("/api/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

export function resetPassword({ token, password, guestCredential }) {
  return apiRequest("/api/auth/reset-password", {
    method: "POST",
    body: { token, password },
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

/** GET /api/queues/history — paginated User or Guest history (newest first, default 20). */
export function fetchHistory(token, guestCredential, options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  return apiRequest(`/api/queues/history${qs ? `?${qs}` : ""}`, { token, guestCredential });
}

/** GET /api/queues/active — every active membership for the current joiner. */
export function fetchActiveMemberships(token, guestCredential) {
  return apiRequest("/api/queues/active", { token, guestCredential });
}

/** GET /api/admin/queues/:queueId/waiting-list — admin waiting list + queue meta. */
export function fetchWaitingList(token, queueId) {
  return apiRequest(`/api/admin/queues/${queueId}/waiting-list`, { token });
}

/**
 * GET /api/admin/queues/:queueId/analytics
 * Ops metrics: served count, average wait, simple peaks (busiest hours).
 */
export function fetchAnalytics(token, queueId, options = {}) {
  const params = new URLSearchParams();
  if (options.window) params.set("window", options.window);
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  const qs = params.toString();
  return apiRequest(`/api/admin/queues/${queueId}/analytics${qs ? `?${qs}` : ""}`, { token });
}

/** POST /api/admin/queues/:queueId/call — call next or selected waiter to the counter. */
export function callQueue(token, queueId, entryId, counterId) {
  const body = {};
  if (entryId) body.entryId = entryId;
  if (counterId) body.counterId = counterId;
  return apiRequest(`/api/admin/queues/${queueId}/call`, {
    method: "POST",
    token,
    body,
  });
}

/** POST /api/admin/queues/:queueId/serve — serve next or selected waiting/serving entry. */
export function serveQueue(token, queueId, entryId, counterId) {
  const body = {};
  if (entryId) body.entryId = entryId;
  if (counterId) body.counterId = counterId;
  return apiRequest(`/api/admin/queues/${queueId}/serve`, {
    method: "POST",
    token,
    body,
  });
}

/** POST /api/admin/queues/:queueId/skip — skip next or selected waiting entry. */
export function skipQueue(token, queueId, entryId, counterId) {
  const body = {};
  if (entryId) body.entryId = entryId;
  if (counterId) body.counterId = counterId;
  return apiRequest(`/api/admin/queues/${queueId}/skip`, {
    method: "POST",
    token,
    body,
  });
}

export function fetchAdminCatalog(token) {
  return apiRequest("/api/admin/catalog", { token });
}

export function createVenue(token, { name }) {
  return apiRequest("/api/admin/venues", { method: "POST", token, body: { name } });
}

export function updateVenue(token, venueId, { name }) {
  return apiRequest(`/api/admin/venues/${venueId}`, { method: "PATCH", token, body: { name } });
}

export function createAdminQueue(token, payload) {
  return apiRequest("/api/admin/queues", { method: "POST", token, body: payload });
}

export function updateAdminQueue(token, queueId, payload) {
  return apiRequest(`/api/admin/queues/${queueId}`, { method: "PATCH", token, body: payload });
}

export function addQueueCounter(token, queueId, { name }) {
  return apiRequest(`/api/admin/queues/${queueId}/counters`, {
    method: "POST",
    token,
    body: { name },
  });
}

export function renameQueueCounter(token, queueId, counterId, { name }) {
  return apiRequest(`/api/admin/queues/${queueId}/counters/${counterId}`, {
    method: "PATCH",
    token,
    body: { name },
  });
}

export function removeQueueCounter(token, queueId, counterId) {
  return apiRequest(`/api/admin/queues/${queueId}/counters/${counterId}`, {
    method: "DELETE",
    token,
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
 * PUT /api/admin/queues/:queueId/service-windows
 * Replace service windows (campus IST HH:mm). Body: { serviceWindows: [{start,end,days?}] }. Optional days scopes a window to weekdays (0=Sun…6=Sat); omit for every day.
 */
export function updateServiceWindows(token, queueId, serviceWindows) {
  return apiRequest(`/api/admin/queues/${queueId}/service-windows`, {
    method: "PUT",
    token,
    body: { serviceWindows },
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
 * Counter arrival check: match a signed QR pass against the waiting
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
