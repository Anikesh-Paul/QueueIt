import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  adminPing,
  fetchHistory,
  fetchMe,
  fetchQueues,
  fetchQueueStatus,
  fetchWaitingList,
  joinQueue,
  leaveQueue,
  login,
  pauseQueue,
  register,
  resumeQueue,
  serveQueue,
  skipQueue,
} from "./api.js";

const TOKEN_KEY = "queueit_token";
/** Poll interval for live status and admin waiting list (must-ship path; no Socket.IO). */
const STATUS_POLL_MS = 3000;

function formatNowServing(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function formatOutcomeLabel(outcome) {
  if (!outcome) return "—";
  return String(outcome).charAt(0).toUpperCase() + String(outcome).slice(1);
}

function formatEventTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminStatus, setAdminStatus] = useState(null);
  const [booting, setBooting] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const [queues, setQueues] = useState([]);
  const [queuesLoading, setQueuesLoading] = useState(false);
  const [queuesError, setQueuesError] = useState("");
  const [selectedQueueId, setSelectedQueueId] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [statusQueueId, setStatusQueueId] = useState(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  /** "queues" | "history" — main app panel for authenticated users. */
  const [panel, setPanel] = useState("queues");
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  /** Admin console state (waiting list + controls for selected queue). */
  const [adminQueueId, setAdminQueueId] = useState(null);
  const [adminQueueMeta, setAdminQueueMeta] = useState(null);
  const [waitingList, setWaitingList] = useState([]);
  const [waitingLoading, setWaitingLoading] = useState(false);
  const [waitingError, setWaitingError] = useState("");
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [adminActionError, setAdminActionError] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const pollRef = useRef(null);
  const adminPollRef = useRef(null);

  const persistSession = useCallback((nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    if (nextToken) {
      localStorage.setItem(TOKEN_KEY, nextToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, []);

  const clearLiveStatus = useCallback(() => {
    setLiveStatus(null);
    setStatusQueueId(null);
    setJoinError("");
    setStatusError("");
    setStatusUpdating(false);
    setLeaveError("");
    setLeaveBusy(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearAdminConsole = useCallback(() => {
    setAdminQueueId(null);
    setAdminQueueMeta(null);
    setWaitingList([]);
    setWaitingError("");
    setWaitingLoading(false);
    setAdminActionError("");
    setAdminActionBusy(false);
    setSelectedEntryId(null);
    if (adminPollRef.current) {
      clearInterval(adminPollRef.current);
      adminPollRef.current = null;
    }
  }, []);

  const logout = useCallback(() => {
    persistSession("", null);
    setAdminStatus(null);
    setError("");
    setQueues([]);
    setQueuesError("");
    setSelectedQueueId(null);
    setPanel("queues");
    setHistoryEvents([]);
    setHistoryError("");
    clearLiveStatus();
    clearAdminConsole();
  }, [persistSession, clearLiveStatus, clearAdminConsole]);

  const restoreActiveMembership = useCallback(async (sessionToken, catalog) => {
    if (!sessionToken || !Array.isArray(catalog)) return false;
    for (const queue of catalog) {
      try {
        const data = await fetchQueueStatus(sessionToken, queue.id);
        setLiveStatus(data);
        setStatusQueueId(queue.id);
        setStatusError("");
        return true;
      } catch {
        // Not in this queue — try next.
      }
    }
    return false;
  }, []);

  const loadQueues = useCallback(
    async (sessionToken, { restoreStatus = false } = {}) => {
      setQueuesLoading(true);
      setQueuesError("");
      try {
        const data = await fetchQueues(sessionToken);
        const catalog = Array.isArray(data.queues) ? data.queues : [];
        setQueues(catalog);
        if (restoreStatus) {
          await restoreActiveMembership(sessionToken, catalog);
        }
      } catch (err) {
        setQueues([]);
        setQueuesError(err.message || "Could not load queues");
      } finally {
        setQueuesLoading(false);
      }
    },
    [restoreActiveMembership]
  );

  const refreshStatus = useCallback(
    async (sessionToken, queueId, { silent } = {}) => {
      if (!sessionToken || !queueId) return;
      if (!silent) setStatusUpdating(true);
      try {
        const data = await fetchQueueStatus(sessionToken, queueId);
        setLiveStatus(data);
        setStatusQueueId(queueId);
        setStatusError("");
      } catch (err) {
        if (err.status === 404) {
          clearLiveStatus();
          setStatusError("");
          return;
        }
        setStatusError(err.message || "Could not refresh status");
      } finally {
        if (!silent) setStatusUpdating(false);
      }
    },
    [clearLiveStatus]
  );

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMe(token);
        if (cancelled) return;
        setUser(data.user);
        if (data.user.role === "admin") {
          try {
            const ping = await adminPing(token);
            if (!cancelled) setAdminStatus(ping.ok ? "ok" : "denied");
          } catch {
            if (!cancelled) setAdminStatus("denied");
          }
        } else {
          setAdminStatus(null);
        }
        if (!cancelled) {
          await loadQueues(token, { restoreStatus: true });
        }
      } catch {
        if (!cancelled) {
          logout();
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, logout, loadQueues]);

  const loadWaitingList = useCallback(
    async (sessionToken, queueId, { silent } = {}) => {
      if (!sessionToken || !queueId) return;
      if (!silent) setWaitingLoading(true);
      try {
        const data = await fetchWaitingList(sessionToken, queueId);
        setAdminQueueMeta(data.queue || null);
        setWaitingList(Array.isArray(data.waiting) ? data.waiting : []);
        setWaitingError("");
        setAdminQueueId(queueId);
      } catch (err) {
        setWaitingError(err.message || "Could not load waiting list");
      } finally {
        if (!silent) setWaitingLoading(false);
      }
    },
    []
  );

  // Poll live status while the user holds a place in line.
  useEffect(() => {
    if (!token || !statusQueueId || !liveStatus) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      refreshStatus(token, statusQueueId, { silent: true });
    }, STATUS_POLL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [token, statusQueueId, liveStatus, refreshStatus]);

  // Poll admin waiting list while console is open.
  useEffect(() => {
    if (!token || !adminQueueId || user?.role !== "admin") {
      if (adminPollRef.current) {
        clearInterval(adminPollRef.current);
        adminPollRef.current = null;
      }
      return;
    }

    adminPollRef.current = setInterval(() => {
      loadWaitingList(token, adminQueueId, { silent: true });
    }, STATUS_POLL_MS);

    return () => {
      if (adminPollRef.current) {
        clearInterval(adminPollRef.current);
        adminPollRef.current = null;
      }
    };
  }, [token, adminQueueId, user?.role, loadWaitingList]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data =
        mode === "login"
          ? await login({ email, password })
          : await register({ email, password, name: name || "User" });
      persistSession(data.token, data.user);
      setPassword("");
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const loadHistory = useCallback(async (sessionToken) => {
    if (!sessionToken) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await fetchHistory(sessionToken);
      setHistoryEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setHistoryEvents([]);
      setHistoryError(err.message || "Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  async function openHistory() {
    setPanel("history");
    await loadHistory(token);
  }

  async function handleJoin() {
    if (!token || !selectedQueueId) return;
    setJoinError("");
    setJoinBusy(true);
    try {
      const data = await joinQueue(token, selectedQueueId);
      setLiveStatus(data);
      setStatusQueueId(selectedQueueId);
      setStatusError("");
      setPanel("queues");
    } catch (err) {
      // Already waiting — resume live status instead of a dead-end error.
      if (err.status === 409) {
        try {
          await refreshStatus(token, selectedQueueId);
          setJoinError("");
          return;
        } catch {
          // fall through to message
        }
      }
      setJoinError(err.message || "Could not join queue");
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleLeave() {
    if (!token || !statusQueueId) return;
    setLeaveError("");
    setLeaveBusy(true);
    try {
      await leaveQueue(token, statusQueueId);
      clearLiveStatus();
      setSelectedQueueId(null);
      setPanel("queues");
    } catch (err) {
      if (err.status === 404) {
        clearLiveStatus();
        setLeaveError("");
        return;
      }
      setLeaveError(err.message || "Could not leave queue");
    } finally {
      setLeaveBusy(false);
    }
  }

  async function openAdminConsole(queueId) {
    if (!token || !queueId) return;
    setSelectedQueueId(queueId);
    setSelectedEntryId(null);
    setAdminActionError("");
    setPanel("queues");
    await loadWaitingList(token, queueId);
  }

  async function handleAdminServe(entryId) {
    if (!token || !adminQueueId) return;
    setAdminActionError("");
    setAdminActionBusy(true);
    try {
      await serveQueue(token, adminQueueId, entryId || undefined);
      setSelectedEntryId(null);
      await loadWaitingList(token, adminQueueId, { silent: true });
    } catch (err) {
      setAdminActionError(err.message || "Serve failed");
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminSkip(entryId) {
    if (!token || !adminQueueId) return;
    setAdminActionError("");
    setAdminActionBusy(true);
    try {
      await skipQueue(token, adminQueueId, entryId || undefined);
      setSelectedEntryId(null);
      await loadWaitingList(token, adminQueueId, { silent: true });
    } catch (err) {
      setAdminActionError(err.message || "Skip failed");
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminPause() {
    if (!token || !adminQueueId) return;
    setAdminActionError("");
    setAdminActionBusy(true);
    try {
      await pauseQueue(token, adminQueueId);
      await loadWaitingList(token, adminQueueId, { silent: true });
    } catch (err) {
      setAdminActionError(err.message || "Pause failed");
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleAdminResume() {
    if (!token || !adminQueueId) return;
    setAdminActionError("");
    setAdminActionBusy(true);
    try {
      await resumeQueue(token, adminQueueId);
      await loadWaitingList(token, adminQueueId, { silent: true });
    } catch (err) {
      setAdminActionError(err.message || "Resume failed");
    } finally {
      setAdminActionBusy(false);
    }
  }

  if (booting) {
    return (
      <main className="shell">
        <p className="shell__muted">Restoring session…</p>
      </main>
    );
  }

  if (user && token) {
    const isAdmin = user.role === "admin";
    const selected = queues.find((q) => q.id === selectedQueueId) || null;
    const inQueue = Boolean(liveStatus && statusQueueId);
    const statusQueueName =
      liveStatus?.queue?.name ||
      queues.find((q) => q.id === statusQueueId)?.name ||
      "Queue";
    const showHistory = panel === "history";
    const showAdminConsole = isAdmin && Boolean(adminQueueId) && !showHistory;
    const adminQueueName =
      adminQueueMeta?.name ||
      queues.find((q) => q.id === adminQueueId)?.name ||
      "Queue";
    const queuePaused = adminQueueMeta?.status === "paused";
    const userQueuePaused = liveStatus?.queue?.status === "paused";

    return (
      <main className="shell shell--wide">
        <header className="shell__header">
          <p className="shell__eyebrow">QueueIt (QIT)</p>
          <h1>
            {showHistory
              ? "Your queue history"
              : showAdminConsole
                ? "Admin control"
                : inQueue
                  ? "Your place in line"
                  : "Available queues"}
          </h1>
          <p className="shell__lede">
            Signed in as <strong>{user.name}</strong>{" "}
            <span className={`badge badge--${user.role}`}>{user.role}</span>
            {isAdmin && adminStatus && (
              <>
                {" "}
                · Admin API {adminStatus === "ok" ? "ok" : "denied"}
              </>
            )}
          </p>
        </header>

        {showHistory && (
          <section className="shell__card history-card" aria-label="Queue history">
            <p className="history-card__lede">
              Past and current queue events — joined, left, served, and skipped.
            </p>

            {historyLoading && <p className="shell__muted">Loading history…</p>}

            {!historyLoading && historyError && (
              <p className="form-error" role="alert">
                {historyError}
              </p>
            )}

            {!historyLoading && !historyError && historyEvents.length === 0 && (
              <p className="shell__muted" data-testid="history-empty">
                No queue events yet. Join a line to start your history.
              </p>
            )}

            {!historyLoading && !historyError && historyEvents.length > 0 && (
              <ul className="history-list" data-testid="history-list">
                {historyEvents.map((event) => (
                  <li
                    key={event.id}
                    className="history-item"
                    data-testid="history-item"
                    data-outcome={event.outcome}
                  >
                    <div className="history-item__row">
                      <span
                        className={`history-outcome history-outcome--${event.outcome}`}
                        data-testid="history-outcome"
                      >
                        {formatOutcomeLabel(event.outcome)}
                      </span>
                      <span className="history-item__token">
                        Token {event.tokenNumber}
                      </span>
                    </div>
                    <p className="history-item__queue">
                      {event.queue?.name || "Queue"}
                    </p>
                    <p className="history-item__time">
                      {formatEventTime(
                        event.outcome === "joined" ? event.joinedAt : event.updatedAt || event.joinedAt
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="session-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => loadHistory(token)}
                disabled={historyLoading}
              >
                Refresh history
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPanel("queues")}
              >
                {inQueue ? "Back to status" : "Back to queues"}
              </button>
              <button type="button" className="btn btn--ghost" onClick={logout}>
                Log out
              </button>
            </div>
          </section>
        )}

        {!showHistory && !showAdminConsole && inQueue && (
          <section className="shell__card status-card" aria-label="Live queue status">
            <div className="status-card__top">
              <div>
                <p className="status-card__queue">{statusQueueName}</p>
                <p className="status-card__hint">
                  Updates every few seconds
                  {statusUpdating ? " · refreshing…" : ""}
                </p>
              </div>
              {userQueuePaused ? (
                <span className="status-paused" aria-live="polite" data-testid="queue-paused">
                  Paused
                </span>
              ) : (
                <span className="status-live" aria-live="polite">
                  Live
                </span>
              )}
            </div>

            <div className="status-grid" role="status">
              <div className="status-metric status-metric--hero">
                <span className="status-metric__label">Token</span>
                <span className="status-metric__value" data-testid="token-number">
                  {liveStatus.tokenNumber}
                </span>
              </div>
              <div className="status-metric">
                <span className="status-metric__label">Position</span>
                <span className="status-metric__value" data-testid="position">
                  {liveStatus.position}
                </span>
              </div>
              <div className="status-metric">
                <span className="status-metric__label">ETA</span>
                <span className="status-metric__value" data-testid="eta">
                  {liveStatus.etaMinutes}
                  <span className="status-metric__unit"> min</span>
                </span>
              </div>
              <div className="status-metric">
                <span className="status-metric__label">Now serving</span>
                <span className="status-metric__value" data-testid="now-serving">
                  {formatNowServing(liveStatus.nowServing)}
                </span>
              </div>
            </div>

            <p className="status-card__formula">
              ETA = position × {liveStatus.averageServiceTime} min/serve
              {userQueuePaused ? " · line paused (advancement frozen)" : ""}
            </p>

            {statusError && (
              <p className="form-error" role="alert">
                {statusError}
              </p>
            )}

            {leaveError && (
              <p className="form-error" role="alert">
                {leaveError}
              </p>
            )}

            <button
              type="button"
              className="btn btn--leave"
              onClick={handleLeave}
              disabled={leaveBusy}
              data-testid="leave-queue"
            >
              {leaveBusy ? "Leaving…" : "Leave queue"}
            </button>

            <div className="session-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => refreshStatus(token, statusQueueId)}
                disabled={statusUpdating}
              >
                Refresh status
              </button>
              <button type="button" className="btn btn--ghost" onClick={openHistory}>
                View history
              </button>
              <button type="button" className="btn btn--ghost" onClick={logout}>
                Log out
              </button>
            </div>
          </section>
        )}

        {showAdminConsole && (
          <section className="shell__card admin-card" aria-label="Admin queue control">
            <div className="admin-card__top">
              <div>
                <p className="admin-card__queue" data-testid="admin-queue-name">
                  {adminQueueName}
                </p>
                <p className="admin-card__hint">
                  Waiting list updates every few seconds
                  {waitingLoading ? " · loading…" : ""}
                </p>
              </div>
              <span
                className={queuePaused ? "status-paused" : "status-live"}
                data-testid="admin-queue-status"
              >
                {queuePaused ? "Paused" : "Open"}
              </span>
            </div>

            <div className="status-grid admin-meta" role="status">
              <div className="status-metric">
                <span className="status-metric__label">Now serving</span>
                <span className="status-metric__value" data-testid="admin-now-serving">
                  {formatNowServing(adminQueueMeta?.nowServing)}
                </span>
              </div>
              <div className="status-metric">
                <span className="status-metric__label">Waiting</span>
                <span className="status-metric__value" data-testid="admin-waiting-count">
                  {waitingList.length}
                </span>
              </div>
            </div>

            {waitingError && (
              <p className="form-error" role="alert">
                {waitingError}
              </p>
            )}

            {adminActionError && (
              <p className="form-error" role="alert" data-testid="admin-action-error">
                {adminActionError}
              </p>
            )}

            <div className="admin-actions" data-testid="admin-actions">
              <button
                type="button"
                className="btn btn--serve"
                onClick={() => handleAdminServe(selectedEntryId || undefined)}
                disabled={adminActionBusy || queuePaused || waitingList.length === 0}
                data-testid="admin-serve"
              >
                {selectedEntryId ? "Serve selected" : "Serve next"}
              </button>
              <button
                type="button"
                className="btn btn--skip"
                onClick={() => handleAdminSkip(selectedEntryId || undefined)}
                disabled={adminActionBusy || queuePaused || waitingList.length === 0}
                data-testid="admin-skip"
              >
                {selectedEntryId ? "Skip selected" : "Skip next"}
              </button>
              {queuePaused ? (
                <button
                  type="button"
                  className="btn btn--resume"
                  onClick={handleAdminResume}
                  disabled={adminActionBusy}
                  data-testid="admin-resume"
                >
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--pause"
                  onClick={handleAdminPause}
                  disabled={adminActionBusy}
                  data-testid="admin-pause"
                >
                  Pause
                </button>
              )}
            </div>

            <h2 className="admin-waiting__title">Waiting list</h2>
            {waitingList.length === 0 && !waitingLoading && (
              <p className="shell__muted" data-testid="admin-waiting-empty">
                No one waiting.
              </p>
            )}
            {waitingList.length > 0 && (
              <ul className="waiting-list" data-testid="admin-waiting-list">
                {waitingList.map((entry) => {
                  const isSelected = entry.id === selectedEntryId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`waiting-card${isSelected ? " waiting-card--selected" : ""}`}
                        onClick={() =>
                          setSelectedEntryId((prev) => (prev === entry.id ? null : entry.id))
                        }
                        aria-pressed={isSelected}
                        data-testid="waiting-entry"
                        data-token={entry.tokenNumber}
                      >
                        <span className="waiting-card__token">#{entry.tokenNumber}</span>
                        <span className="waiting-card__body">
                          <span className="waiting-card__name">
                            {entry.user?.name || "Guest"}
                          </span>
                          <span className="waiting-card__meta">
                            Position {entry.position}
                            {entry.user?.email ? ` · ${entry.user.email}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="session-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => loadWaitingList(token, adminQueueId)}
                disabled={waitingLoading}
              >
                Refresh list
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  clearAdminConsole();
                  setSelectedQueueId(null);
                }}
              >
                Back to queues
              </button>
              <button type="button" className="btn btn--ghost" onClick={logout}>
                Log out
              </button>
            </div>
          </section>
        )}

        {!showHistory && !showAdminConsole && !inQueue && (
          <section className="shell__card" aria-label="Queue catalog">
            {queuesLoading && <p className="shell__muted">Loading queues…</p>}

            {!queuesLoading && queuesError && (
              <p className="form-error" role="alert">
                {queuesError}
              </p>
            )}

            {!queuesLoading && !queuesError && queues.length === 0 && (
              <p className="shell__muted">
                No queues yet. Run <code>npm run seed</code> on the server, then refresh.
              </p>
            )}

            {!queuesLoading && !queuesError && queues.length > 0 && (
              <ul className="queue-list">
                {queues.map((queue) => {
                  const isSelected = queue.id === selectedQueueId;
                  return (
                    <li key={queue.id}>
                      <button
                        type="button"
                        className={`queue-card${isSelected ? " queue-card--selected" : ""}`}
                        onClick={() => {
                          setSelectedQueueId(queue.id);
                          setJoinError("");
                        }}
                        aria-pressed={isSelected}
                      >
                        <span className="queue-card__name">{queue.name}</span>
                        <span className="queue-card__meta">
                          {queue.venue?.name || "Venue"} · ~{queue.averageServiceTime} min/serve ·{" "}
                          {queue.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {selected && (
              <div className="queue-selected" role="status">
                <p>
                  Selected <strong>{selected.name}</strong>
                  {selected.venue?.name ? ` at ${selected.venue.name}` : ""}.
                  {isAdmin
                    ? " Open admin control to see the waiting list and serve, skip, or pause."
                    : " Join to get a token and live wait estimate."}
                </p>
                {isAdmin ? (
                  <button
                    type="button"
                    className="btn btn--join"
                    onClick={() => openAdminConsole(selected.id)}
                    data-testid="open-admin-console"
                  >
                    Manage {selected.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--join"
                    onClick={handleJoin}
                    disabled={joinBusy}
                  >
                    {joinBusy ? "Joining…" : `Join ${selected.name}`}
                  </button>
                )}
              </div>
            )}

            {joinError && (
              <p className="form-error" role="alert">
                {joinError}
              </p>
            )}

            <div className="session-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => loadQueues(token)}
                disabled={queuesLoading}
              >
                Refresh list
              </button>
              {!isAdmin && (
                <button type="button" className="btn btn--ghost" onClick={openHistory}>
                  View history
                </button>
              )}
              <button type="button" className="btn btn--ghost" onClick={logout}>
                Log out
              </button>
            </div>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="shell__header">
        <p className="shell__eyebrow">QueueIt (QIT)</p>
        <h1>{mode === "login" ? "Log in" : "Register"}</h1>
        <p className="shell__lede">
          Students register as <strong>user</strong>. Admins use a seeded account (see README).
        </p>
      </header>

      <section className="shell__card" aria-label="Auth form">
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setMode("register");
                  setError("");
                }}
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                Log in
              </button>
            </>
          )}
        </p>
      </section>
    </main>
  );
}

export default App;
