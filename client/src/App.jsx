import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { adminPing, fetchMe, fetchQueues, login, register } from "./api.js";

const TOKEN_KEY = "queueit_token";

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

  const persistSession = useCallback((nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    if (nextToken) {
      localStorage.setItem(TOKEN_KEY, nextToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, []);

  const logout = useCallback(() => {
    persistSession("", null);
    setAdminStatus(null);
    setError("");
    setQueues([]);
    setQueuesError("");
    setSelectedQueueId(null);
  }, [persistSession]);

  const loadQueues = useCallback(async (sessionToken) => {
    setQueuesLoading(true);
    setQueuesError("");
    try {
      const data = await fetchQueues(sessionToken);
      setQueues(Array.isArray(data.queues) ? data.queues : []);
    } catch (err) {
      setQueues([]);
      setQueuesError(err.message || "Could not load queues");
    } finally {
      setQueuesLoading(false);
    }
  }, []);

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
          await loadQueues(token);
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

  if (booting) {
    return (
      <main className="shell">
        <p className="shell__muted">Restoring session…</p>
      </main>
    );
  }

  if (user && token) {
    const selected = queues.find((q) => q.id === selectedQueueId) || null;

    return (
      <main className="shell shell--wide">
        <header className="shell__header">
          <p className="shell__eyebrow">QueueIt (QIT)</p>
          <h1>Available queues</h1>
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
                      onClick={() => setSelectedQueueId(queue.id)}
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
                {selected.venue?.name ? ` at ${selected.venue.name}` : ""}. Join lands in the next
                ticket — selection is ready.
              </p>
            </div>
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
