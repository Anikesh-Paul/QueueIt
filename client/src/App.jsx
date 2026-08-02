import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  adminPing,
  fetchMe,
  fetchQueues,
  fetchQueueStatus,
  joinQueue,
  login,
  register,
} from "./api.js";

const TOKEN_KEY = "queueit_token";
/** Poll interval for live status (must-ship path; no Socket.IO). */
const STATUS_POLL_MS = 3000;

function formatNowServing(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
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
  const pollRef = useRef(null);

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
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const logout = useCallback(() => {
    persistSession("", null);
    setAdminStatus(null);
    setError("");
    setQueues([]);
    setQueuesError("");
    setSelectedQueueId(null);
    clearLiveStatus();
  }, [persistSession, clearLiveStatus]);

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

  async function handleJoin() {
    if (!token || !selectedQueueId) return;
    setJoinError("");
    setJoinBusy(true);
    try {
      const data = await joinQueue(token, selectedQueueId);
      setLiveStatus(data);
      setStatusQueueId(selectedQueueId);
      setStatusError("");
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

  if (booting) {
    return (
      <main className="shell">
        <p className="shell__muted">Restoring session…</p>
      </main>
    );
  }

  if (user && token) {
    const selected = queues.find((q) => q.id === selectedQueueId) || null;
    const inQueue = Boolean(liveStatus && statusQueueId);
    const statusQueueName =
      liveStatus?.queue?.name ||
      queues.find((q) => q.id === statusQueueId)?.name ||
      "Queue";

    return (
      <main className="shell shell--wide">
        <header className="shell__header">
          <p className="shell__eyebrow">QueueIt (QIT)</p>
          <h1>{inQueue ? "Your place in line" : "Available queues"}</h1>
          <p className="shell__lede">
            Signed in as <strong>{user.name}</strong>{" "}
            <span className={`badge badge--${user.role}`}>{user.role}</span>
            {user.role === "admin" && adminStatus && (
              <>
                {" "}
                · Admin API {adminStatus === "ok" ? "ok" : "denied"}
              </>
            )}
          </p>
        </header>

        {inQueue && (
          <section className="shell__card status-card" aria-label="Live queue status">
            <div className="status-card__top">
              <div>
                <p className="status-card__queue">{statusQueueName}</p>
                <p className="status-card__hint">
                  Updates every few seconds
                  {statusUpdating ? " · refreshing…" : ""}
                </p>
              </div>
              <span className="status-live" aria-live="polite">
                Live
              </span>
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
            </p>

            {statusError && (
              <p className="form-error" role="alert">
                {statusError}
              </p>
            )}

            <div className="session-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => refreshStatus(token, statusQueueId)}
                disabled={statusUpdating}
              >
                Refresh status
              </button>
              <button type="button" className="btn btn--ghost" onClick={logout}>
                Log out
              </button>
            </div>
          </section>
        )}

        {!inQueue && (
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
                  {selected.venue?.name ? ` at ${selected.venue.name}` : ""}. Join to get a token
                  and live wait estimate.
                </p>
                <button
                  type="button"
                  className="btn btn--join"
                  onClick={handleJoin}
                  disabled={joinBusy}
                >
                  {joinBusy ? "Joining…" : `Join ${selected.name}`}
                </button>
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
