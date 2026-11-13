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

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // No network (or the API is unreachable): a typed error the UI can explain.
    const err = new Error("You’re offline. Reconnect and try again.");
    err.offline = true;
    err.cause = cause;
    throw err;
  }

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
    const cachedAt = Date.parse(res.headers.get("X-QueueIt-Cached-At") || "");
    if (Number.isFinite(cachedAt)) {
      Object.defineProperty(data, "_cachedAt", { value: cachedAt, enumerable: false });
    }
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

/** POST /api/auth/login/2fa — second step: { challenge, code } → session. */
export function loginTwoFactor({ challenge, code }) {
  return apiRequest("/api/auth/login/2fa", { method: "POST", body: { challenge, code } });
}

export function fetchTwoFactorStatus(token) {
  return apiRequest("/api/auth/2fa", { token });
}

export function startTwoFactorSetup(token, password) {
  return apiRequest("/api/auth/2fa/setup", { method: "POST", token, body: { password } });
}

export function enableTwoFactor(token, code) {
  return apiRequest("/api/auth/2fa/enable", { method: "POST", token, body: { code } });
}

export function disableTwoFactor(token, code) {
  return apiRequest("/api/auth/2fa/disable", { method: "POST", token, body: { code } });
}

export function regenerateBackupCodes(token, code) {
  return apiRequest("/api/auth/2fa/backup-codes", { method: "POST", token, body: { code } });
}

/** POST /api/auth/logout-all — every session for this account stops working. */
export function logoutAllDevices(token) {
  return apiRequest("/api/auth/logout-all", { method: "POST", token });
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
export function joinQueue(token, queueId, guestCredential, source) {
  return apiRequest(`/api/queues/${queueId}/join`, {
    method: "POST",
    token,
    guestCredential,
    ...(source === "qr" ? { body: { source: "qr" } } : {}),
  });
}

/** GET /api/queues/:queueId/board — public now-serving display (token numbers only). */
export function getQueueBoard(queueId) {
  return apiRequest(`/api/queues/${queueId}/board`);
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

/** POST /api/queues/:queueId/here — called student checks in ("I'm here"). */
export function acknowledgeArrival(token, queueId, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/here`, {
    method: "POST",
    token,
    guestCredential,
  });
}

/** POST /api/queues/:queueId/travel — minutes it takes to reach the counter. */
export function setTravelMinutes(token, queueId, minutes, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/travel`, {
    method: "POST",
    token,
    guestCredential,
    body: { minutes },
  });
}

/** GET /api/queues/feedback/pending — recent served visits with no rating yet. */
export function fetchPendingFeedback(token, guestCredential) {
  return apiRequest("/api/queues/feedback/pending", { token, guestCredential });
}

/** POST /api/queues/feedback — one 1–5 rating (and optional comment) per served ticket. */
export function sendFeedback(token, { entryId, rating, comment }, guestCredential) {
  return apiRequest("/api/queues/feedback", {
    method: "POST",
    token,
    guestCredential,
    body: { entryId, rating, comment },
  });
}

/** POST /api/queues/:queueId/rejoin — recover a missed (skipped) turn once. */
export function rejoinQueue(token, queueId, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/rejoin`, {
    method: "POST",
    token,
    guestCredential,
  });
}

export function requestPriority(token, queueId, reason, guestCredential) {
  return apiRequest(`/api/queues/${queueId}/priority-request`, {
    method: "POST",
    token,
    guestCredential,
    body: { reason },
  });
}

export function markEntryPriority(token, queueId, entryId, reason) {
  return apiRequest(`/api/admin/queues/${queueId}/entries/${entryId}/priority`, {
    method: "POST",
    token,
    body: { reason },
  });
}

export function decidePriorityRequest(token, queueId, entryId, approve) {
  return apiRequest(`/api/admin/queues/${queueId}/entries/${entryId}/priority-decision`, {
    method: "POST",
    token,
    body: { approve: Boolean(approve) },
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

/** GET /api/admin/analytics/report — campus-day range report (admin / venue staff). */
export function fetchAnalyticsReport(token, query) {
  return apiRequest(`/api/admin/analytics/report${query ? `?${query}` : ""}`, { token });
}

/** GET /api/admin/analytics/report.csv — download the same report as CSV. */
export async function downloadAnalyticsReportCsv(token, query, filename = "queueit-report.csv") {
  const res = await fetch(`${API_URL}/api/admin/analytics/report.csv${query ? `?${query}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // keep status message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function fetchAdminAudit(token, options = {}) {
  const params = new URLSearchParams();
  if (options.queueId) params.set("queueId", options.queueId);
  if (options.venueId) params.set("venueId", options.venueId);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  for (const key of ["category", "actorId", "from", "to"]) {
    if (options[key]) params.set(key, String(options[key]));
  }
  const qs = params.toString();
  return apiRequest(`/api/admin/audit${qs ? `?${qs}` : ""}`, { token });
}

/** GET /api/admin/audit/actors — people in the log I can see. */
export function fetchAuditActors(token) {
  return apiRequest("/api/admin/audit/actors", { token });
}

/** GET /api/admin/audit.csv — download the filtered log. */
export async function downloadAuditCsv(token, query, filename = "queueit-audit-log.csv") {
  const res = await fetch(`${API_URL}/api/admin/audit.csv${query ? `?${query}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // keep status message
    }
    throw new Error(message);
  }
  const text = await res.text();
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return Math.max(0, text.trim().split("\n").length - 1);
}

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

export function createVenue(token, { name, organizationId }) {
  return apiRequest("/api/admin/venues", {
    method: "POST",
    token,
    body: organizationId ? { name, organizationId } : { name },
  });
}

export function inviteStaff(token, payload) {
  return apiRequest("/api/admin/staff", { method: "POST", token, body: payload });
}

export function fetchStaffAccounts(token) {
  return apiRequest("/api/admin/staff", { token });
}

export function updateStaffQueues(token, staffId, { queueIds }) {
  return apiRequest(`/api/admin/staff/${staffId}`, {
    method: "PATCH",
    token,
    body: { queueIds },
  });
}

export function updateVenue(token, venueId, { name, organizationId }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (organizationId !== undefined) body.organizationId = organizationId;
  return apiRequest(`/api/admin/venues/${venueId}`, { method: "PATCH", token, body });
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
 * Replace service windows (campus IST HH:mm). Body: { serviceWindows, serviceExceptions? }.
 * Optional days scopes a window to weekdays (0=Sun…6=Sat); omit for every day.
 * Optional serviceExceptions override a calendar day (closed, or alternate hours).
 */
export function updateServiceWindows(token, queueId, serviceWindows, serviceExceptions) {
  const body = { serviceWindows };
  if (serviceExceptions !== undefined) body.serviceExceptions = serviceExceptions;
  return apiRequest(`/api/admin/queues/${queueId}/service-windows`, {
    method: "PUT",
    token,
    body,
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

/** GET /api/queues/:id/slots — bookable slot grid for one campus day. */
export function fetchSlots(token, queueId, date) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiRequest(`/api/queues/${queueId}/slots${qs}`, { token });
}

/** POST /api/queues/:id/appointments — book a slot (signed-in users only). */
export function bookSlot(token, queueId, start) {
  return apiRequest(`/api/queues/${queueId}/appointments`, { method: "POST", token, body: { start } });
}

export function cancelBooking(token, queueId, appointmentId) {
  return apiRequest(`/api/queues/${queueId}/appointments/${appointmentId}/cancel`, { method: "POST", token });
}

/** Self check-in: returns the live status payload for the new place in line. */
export function checkInBooking(token, queueId, appointmentId) {
  return apiRequest(`/api/queues/${queueId}/appointments/${appointmentId}/check-in`, { method: "POST", token });
}

export function fetchMyAppointments(token) {
  return apiRequest("/api/queues/appointments/mine", { token });
}

export function fetchQueueAppointments(token, queueId, date) {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiRequest(`/api/admin/queues/${queueId}/appointments${qs}`, { token });
}

export function adminCheckInAppointment(token, queueId, appointmentId) {
  return apiRequest(`/api/admin/queues/${queueId}/appointments/${appointmentId}/check-in`, {
    method: "POST",
    token,
  });
}

/** GET /api/admin/shifts — my shift plus every counter I can manage. */
export function fetchShiftBoard(token) {
  return apiRequest("/api/admin/shifts", { token });
}

/** POST shift action: start | break | back | end | open | close. */
export function shiftAction(token, queueId, counterId, action) {
  return apiRequest(`/api/admin/queues/${queueId}/counters/${counterId}/shift`, {
    method: "POST",
    token,
    body: { action },
  });
}

/** GET /api/queues/announcements — live notices (all, or only those for one queue). Public. */
export function fetchNotices(queueId) {
  return apiRequest(`/api/queues/announcements${queueId ? `?queueId=${encodeURIComponent(queueId)}` : ""}`);
}

/** GET /api/admin/announcements — live, scheduled and recent notices I can see. */
export function fetchConsoleNotices(token) {
  return apiRequest("/api/admin/announcements", { token });
}

export function postNotice(token, body) {
  return apiRequest("/api/admin/announcements", { method: "POST", token, body });
}

export function editNotice(token, id, body) {
  return apiRequest(`/api/admin/announcements/${id}`, { method: "PATCH", token, body });
}

export function endNotice(token, id) {
  return apiRequest(`/api/admin/announcements/${id}/end`, { method: "POST", token });
}

/** GET /api/queues/organizations — organizations with open lines. Public. */
export function fetchOrganizations() {
  return apiRequest("/api/queues/organizations");
}

/** GET /api/admin/organizations — every organization, including empty ones. */
export function fetchAdminOrganizations(token) {
  return apiRequest("/api/admin/organizations", { token });
}

export function createOrganization(token, { name }) {
  return apiRequest("/api/admin/organizations", { method: "POST", token, body: { name } });
}

export function renameOrganization(token, id, { name }) {
  return apiRequest(`/api/admin/organizations/${id}`, { method: "PATCH", token, body: { name } });
}
