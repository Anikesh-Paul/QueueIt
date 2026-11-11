import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, register } from "@/api";
import { useApp } from "@/context/app-context";
import { Alert } from "@/components/ui/alert";
import { isSafeAppPath } from "@/lib/join-link";
import { AUTH_SUBTITLE } from "@/lib/auth-copy";
import { clearOfflineStatusCache } from "@/lib/register-sw";

const SUBTITLE = {
  login: AUTH_SUBTITLE,
  register: AUTH_SUBTITLE,
};

/**
 * Auth form (login | register). Shared layout; quiet elevation on kit primitives.
 * On success the session persists and the router redirects "/" to /status or /queues.
 * Continue as Guest enters the student path without a User account.
 */
function pathAfterAuth(from, fallback) {
  return isSafeAppPath(from) ? from : fallback;
}

export function AuthForm({ mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { persistSession, enterGuestMode, guestCredential, isGuest } = useApp();
  const from = location.state?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Soft upgrade: present Guest credential is claimed + retired on the server.
      const guestCred = guestCredential || null;
      const data =
        mode === "login"
          ? await login({ email, password, guestCredential: guestCred })
          : await register({
              email,
              password,
              name: name || "User",
              guestCredential: guestCred,
            });
      persistSession(data.token, data.user);
      clearOfflineStatusCache();
      setPassword("");
      navigate(pathAfterAuth(from, "/"), { replace: true });
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function handleContinueAsGuest() {
    enterGuestMode();
    navigate(pathAfterAuth(from, "/queues"), { replace: true });
  }

  const fieldClass =
    "h-11 rounded-md border-border bg-background/60 px-3.5 text-[0.9375rem] shadow-none transition-[border-color,box-shadow] placeholder:text-text-muted focus-visible:border-primary focus-visible:bg-card";

  return (
    <div className="w-full max-w-[22rem]">
      <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.015em] text-foreground">
        {mode === "login" ? "Log in" : "Register"}
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-snug text-text-secondary">
        {SUBTITLE[mode]}
      </p>

      {isGuest ? (
        <div
          className="mt-5 rounded-lg border border-primary-muted bg-primary-muted/40 px-3.5 py-3"
          data-testid="soft-upgrade-auth-hint"
        >
          <p className="text-sm font-semibold text-foreground">Keep your history</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            Register or log in on this device to claim your place and past events.
          </p>
        </div>
      ) : null}

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
        {mode === "register" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name" className="text-label text-foreground">
              Name
            </Label>
            <Input
              id="name"
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Your name"
              className={fieldClass}
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-label text-foreground">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-label text-foreground">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8–128 characters"
            className={fieldClass}
          />
        </div>

        {error && (
          <Alert variant="destructive" className="text-sm">
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={busy}
          className="mt-1 h-11 w-full text-[0.9375rem] font-semibold tracking-[-0.01em]"
        >
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        {mode === "login" ? (
          <>
            No account?{" "}
            <Link
              to="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Register
            </Link>
          </>
        ) : (
          <>
            Already registered?{" "}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Log in
            </Link>
          </>
        )}
      </p>

      {!isGuest ? (
        <div className="mt-6 border-t border-border pt-6">
          <p className="mb-3 text-center text-xs text-text-muted">
            No account needed to join a line
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 w-full text-[0.9375rem]"
            onClick={handleContinueAsGuest}
            data-testid="continue-as-guest"
          >
            Continue as Guest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
