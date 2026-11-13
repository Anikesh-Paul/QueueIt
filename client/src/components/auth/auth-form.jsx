import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, loginTwoFactor, register } from "@/api";
import { cleanCode, codeLooksComplete, loginOutcome } from "@/lib/two-factor";
import { peekAuthFlash, setAuthFlash, takeAuthFlashNotice } from "@/lib/auth-flash";
import { useApp } from "@/context/app-context";
import { Alert } from "@/components/ui/alert";
import { isSafeAppPath } from "@/lib/join-link";
import { useI18n } from "@/context/i18n-context";
import { clearOfflineStatusCache } from "@/lib/register-sw";

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
  const { t } = useI18n();
  const from = location.state?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Two-step sign-in: set after the password step for enrolled accounts. */
  const [challenge, setChallenge] = useState(() => location.state?.twoFactorChallenge || "");
  const [codeMode, setCodeMode] = useState("app");
  const [code, setCode] = useState("");
  const [notice] = useState(() => peekAuthFlash()?.notice || location.state?.notice || "");
  useEffect(() => {
    // Clear after reading (not inside the initializer: StrictMode runs it twice).
    takeAuthFlashNotice();
  }, []);

  function finish(data) {
    persistSession(data.token, data.user);
    clearOfflineStatusCache();
    setPassword("");
    if (data.backupCodesRemaining != null) {
      setAuthFlash({ notice: t("auth.backupLeft", { n: data.backupCodesRemaining }), to: "/security" });
      navigate("/security", { replace: true });
      return;
    }
    navigate(pathAfterAuth(from, "/"), { replace: true });
  }

  async function handleCodeSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await loginTwoFactor({
        challenge,
        code: codeMode === "app" ? cleanCode(code) : code.trim(),
      });
      finish(data);
    } catch (err) {
      setCode("");
      if (err.status === 401 && /timed out/i.test(err.message || "")) setChallenge("");
      setError(err.message || t("auth.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setChallenge("");
    setCode("");
    setCodeMode("app");
    setError("");
    setPassword("");
  }

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
              name: name.trim(),
              guestCredential: guestCred,
            });
      const outcome = loginOutcome(data);
      if (outcome.step === "code") {
        setChallenge(outcome.challenge);
        setPassword("");
        setCode("");
        return;
      }
      finish(data);
    } catch (err) {
      setError(err.message || t("auth.requestFailed"));
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

  if (mode === "login" && challenge) {
    const complete = codeLooksComplete(code, codeMode);
    return (
      <div className="w-full max-w-[22rem]" data-testid="two-step-form">
        <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.015em] text-foreground">
          {t("auth.codeTitle")}
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-snug text-text-secondary">
          {codeMode === "app" ? t("auth.codeIntro") : t("auth.backupIntro")}
        </p>
        <form className="mt-8 flex flex-col gap-5" onSubmit={handleCodeSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="two-step-code" className="text-label text-foreground">
              {codeMode === "app" ? t("auth.codeLabel") : t("auth.backupLabel")}
            </Label>
            <Input
              id="two-step-code"
              name="code"
              type="text"
              autoFocus
              required
              autoComplete="one-time-code"
              inputMode={codeMode === "app" ? "numeric" : "text"}
              pattern={codeMode === "app" ? "[0-9 ]*" : undefined}
              maxLength={codeMode === "app" ? 7 : 11}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={codeMode === "app" ? "123456" : "xxxxx-xxxxx"}
              className={`${fieldClass} font-mono tracking-[0.2em]`}
              data-testid="two-step-code"
            />
          </div>
          {error && (
            <Alert variant="destructive" className="text-sm" data-testid="two-step-error">
              {error}
            </Alert>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={busy || !complete}
            className="mt-1 h-11 w-full text-[0.9375rem] font-semibold tracking-[-0.01em]"
            data-testid="two-step-submit"
          >
            {busy ? t("auth.pleaseWait") : t("auth.verify")}
          </Button>
        </form>
        <div className="mt-6 flex flex-col items-center gap-3 text-sm">
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setCodeMode((m) => (m === "app" ? "backup" : "app"));
              setCode("");
              setError("");
            }}
            data-testid="two-step-toggle"
          >
            {codeMode === "app" ? t("auth.useBackup") : t("auth.useApp")}
          </button>
          <button
            type="button"
            className="text-text-secondary underline-offset-4 hover:underline"
            onClick={startOver}
          >
            {t("auth.startOver")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[22rem]">
      {notice ? (
        <Alert className="mb-6 text-sm" data-testid="auth-notice">
          {notice}
        </Alert>
      ) : null}
      <h1 className="font-display text-display font-semibold leading-tight tracking-[-0.015em] text-foreground">
        {mode === "login" ? t("auth.login") : t("auth.register")}
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-snug text-text-secondary">
        {t("auth.subtitle")}
      </p>

      {isGuest ? (
        <div
          className="mt-5 rounded-lg border border-primary-muted bg-primary-muted/40 px-3.5 py-3"
          data-testid="soft-upgrade-auth-hint"
        >
          <p className="text-sm font-semibold text-foreground">{t("auth.keepHistory")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
            {t("auth.keepHistoryBody")}
          </p>
        </div>
      ) : null}

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
        {mode === "register" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name" className="text-label text-foreground">
              {t("auth.name")}
            </Label>
            <Input
              id="name"
              type="text"
              name="name"
              autoComplete="name"
              required
              minLength={1}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("auth.namePlaceholder")}
              className={fieldClass}
              data-testid="register-name"
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-label text-foreground">
            {t("auth.email")}
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
            {t("auth.password")}
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
            placeholder={t("auth.passwordHint")}
            className={fieldClass}
          />
          {mode === "login" ? (
            <p className="text-right text-sm">
              <Link
                to="/forgot-password"
                className="font-medium text-primary underline-offset-4 hover:underline"
                data-testid="forgot-password-link"
              >
                {t("auth.forgotLink")}
              </Link>
            </p>
          ) : null}
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
          {busy ? t("auth.pleaseWait") : mode === "login" ? t("auth.login") : t("auth.createAccount")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        {mode === "login" ? (
          <>
            {t("auth.noAccount")}{" "}
            <Link
              to="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("auth.register")}
            </Link>
          </>
        ) : (
          <>
            {t("auth.alreadyRegistered")}{" "}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("auth.login")}
            </Link>
          </>
        )}
      </p>

      {!isGuest ? (
        <div className="mt-6 border-t border-border pt-6">
          <p className="mb-3 text-center text-xs text-text-muted">
            {t("auth.guestHint")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 w-full text-[0.9375rem]"
            onClick={handleContinueAsGuest}
            data-testid="continue-as-guest"
          >
            {t("auth.continueGuest")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
