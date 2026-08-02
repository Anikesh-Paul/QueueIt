import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { adminPing, fetchMe, login, register } from "./api.js";

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
  }, [persistSession]);

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
  }, [token, logout]);

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
    return (
      <main className="shell">
        <header className="shell__header">
          <p className="shell__eyebrow">QueueIt (QIT)</p>
          <h1>Signed in</h1>
          <p className="shell__lede">
            JWT session active. Queues land in later tickets — this screen confirms auth & roles.
          </p>
        </header>

        <section className="shell__card" aria-label="Session">
          <dl className="session">
            <div>
              <dt>Name</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>
                <span className={`badge badge--${user.role}`}>{user.role}</span>
              </dd>
            </div>
            {user.role === "admin" && (
              <div>
                <dt>Admin API</dt>
                <dd>{adminStatus === "ok" ? "ping ok" : adminStatus === "denied" ? "denied" : "…"}</dd>
              </div>
            )}
          </dl>
          <button type="button" className="btn btn--ghost" onClick={logout}>
            Log out
          </button>
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
              <button type="button" className="linkish" onClick={() => { setMode("register"); setError(""); }}>
                Register
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button type="button" className="linkish" onClick={() => { setMode("login"); setError(""); }}>
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
