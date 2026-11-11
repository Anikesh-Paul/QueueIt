import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { forgotPassword, resetPassword } from "@/api";
import { useApp } from "@/context/app-context";
import { clearOfflineStatusCache } from "@/lib/register-sw";
import { FORGOT_PASSWORD_NOTICE } from "@/lib/auth-copy";

const fieldClass =
  "h-11 rounded-md border-border bg-background/60 px-3.5 text-[0.9375rem] shadow-none transition-[border-color,box-shadow] placeholder:text-text-muted focus-visible:border-primary focus-visible:bg-card";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await forgotPassword({ email });
      setDone(true);
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-[22rem]">
        <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.015em] text-foreground">
          Forgot password
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-snug text-text-secondary">
          Enter the email on your account. If an account exists for that email, we’ll send a reset link.
        </p>

        {done ? (
          <p className="mt-8 text-sm leading-relaxed text-foreground" data-testid="forgot-password-sent">
            {FORGOT_PASSWORD_NOTICE}
          </p>
        ) : (
          <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
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
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className={fieldClass}
                data-testid="forgot-password-email"
              />
            </div>
            {error ? (
              <Alert variant="destructive" className="text-sm">
                {error}
              </Alert>
            ) : null}
            <Button
              type="submit"
              size="lg"
              disabled={busy}
              className="mt-1 h-11 w-full text-[0.9375rem] font-semibold tracking-[-0.01em]"
              data-testid="forgot-password-submit"
            >
              {busy ? "Please wait…" : "Send reset link"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { persistSession, guestCredential } = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don’t match");
      return;
    }
    setBusy(true);
    try {
      const data = await resetPassword({
        token,
        password,
        guestCredential: guestCredential || null,
      });
      persistSession(data.token, data.user);
      clearOfflineStatusCache();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-[22rem]">
        <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.015em] text-foreground">
          Set a new password
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-snug text-text-secondary">
          Choose a password of 8–128 characters. This link can only be used once.
        </p>

        {!token ? (
          <p className="mt-8 text-sm text-text-secondary" data-testid="reset-password-missing">
            This reset link is invalid or has expired.
          </p>
        ) : (
          <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-label text-foreground">
                New password
              </Label>
              <Input
                id="password"
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="8–128 characters"
                className={fieldClass}
                data-testid="reset-password-input"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password" className="text-label text-foreground">
                Confirm password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className={fieldClass}
                data-testid="reset-password-confirm"
              />
            </div>
            {error ? (
              <Alert variant="destructive" className="text-sm">
                {error}
              </Alert>
            ) : null}
            <Button
              type="submit"
              size="lg"
              disabled={busy}
              className="mt-1 h-11 w-full text-[0.9375rem] font-semibold tracking-[-0.01em]"
              data-testid="reset-password-submit"
            >
              {busy ? "Please wait…" : "Save password and log in"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
