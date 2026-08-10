import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, register } from "@/api";
import { useApp } from "@/context/app-context";
import { Alert } from "@/components/ui/alert";

/**
 * Auth form (login | register). Keeps scaffold form behavior; renders inside
 * the shared AuthLayout. On success the session persists and the router
 * redirects "/" to /status (in queue) or /queues.
 * Continue as Guest enters the student path without a User account (credential on first join).
 */
export function AuthForm({ mode }) {
  const navigate = useNavigate();
  const { persistSession, enterGuestMode } = useApp();
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
      const data =
        mode === "login"
          ? await login({ email, password })
          : await register({ email, password, name: name || "User" });
      persistSession(data.token, data.user);
      setPassword("");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function handleContinueAsGuest() {
    enterGuestMode();
    navigate("/queues", { replace: true });
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.01em] text-foreground">
        {mode === "login" ? "Log in" : "Register"}
      </h1>
      <p className="mt-1.5 text-sm text-text-secondary">
        {mode === "login" ? "Sign in to QueueIt." : "Create a student account."}
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        {mode === "register" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="h-10 rounded-md px-3"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-10 rounded-md px-3"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="h-10 rounded-md px-3"
          />
        </div>

        {error && (
          <Alert variant="destructive" className="text-sm">
            {error}
          </Alert>
        )}

        <Button type="submit" size="lg" disabled={busy} className="mt-1 w-full">
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-text-secondary">
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

      <div className="mt-4 border-t border-border pt-4 text-center">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={handleContinueAsGuest}
          data-testid="continue-as-guest"
        >
          Continue as Guest
        </Button>
        <p className="mt-2 text-xs text-text-muted">
          Join a line without an account. Soft upgrade is optional later.
        </p>
      </div>
    </div>
  );
}