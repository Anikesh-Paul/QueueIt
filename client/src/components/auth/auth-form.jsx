import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { QrCode, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { login, loginTwoFactor, register } from "@/api";
import { cleanCode, codeLooksComplete, loginOutcome } from "@/lib/two-factor";
import { peekAuthFlash, setAuthFlash, takeAuthFlashNotice } from "@/lib/auth-flash";
import { describeAuthError, emailError, nameError, passwordError, validateAuthForm } from "@/lib/auth-validation";
import { useApp } from "@/context/app-context";
import { isSafeAppPath } from "@/lib/join-link";
import { useI18n } from "@/context/i18n-context";
import { clearOfflineStatusCache } from "@/lib/register-sw";
import {
  AuthDivider,
  AuthErrorAlert,
  AuthField,
  AuthHeading,
  AuthSubmit,
  PasswordField,
} from "@/components/auth/auth-fields";

/**
 * Auth form (login | register). On success the session persists and the
 * router redirects "/" to /status or /queues. Continue as Guest enters the
 * student path without a User account. Enrolled accounts get a second step
 * for their authenticator (or backup) code.
 */
function pathAfterAuth(from, fallback) {
  return isSafeAppPath(from) ? from : fallback;
}

const linkClass =
  "rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function AuthForm({ mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { persistSession, enterGuestMode, guestCredential, isGuest } = useApp();
  const { t } = useI18n();
  const from = location.state?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  /** Two-step sign-in: set after the password step for enrolled accounts. */
  const [challenge, setChallenge] = useState(() => location.state?.twoFactorChallenge || "");
  const [codeMode, setCodeMode] = useState("app");
  const [code, setCode] = useState("");
  const [notice] = useState(() => peekAuthFlash()?.notice || location.state?.notice || "");
  const errorRef = useRef(null);
  useEffect(() => {
    // Clear after reading (not inside the initializer: StrictMode runs it twice).
    takeAuthFlashNotice();
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

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

  /** Re-check a field once the person has left it (or after a submit attempt). */
  function check(field, value) {
    const next =
      field === "email" ? emailError(value) : field === "password" ? passwordError(value, { mode }) : nameError(value);
    setFieldErrors((prev) => ({ ...prev, [field]: next }));
  }
  function onChangeField(field, setter) {
    return (e) => {
      setter(e.target.value);
      if (touched[field] && fieldErrors[field]) check(field, e.target.value);
    };
  }
  function onBlurField(field, value) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    // Don't nag about an empty field the person only tabbed through.
    if (value || fieldErrors[field]) check(field, value);
  }

  async function handleCodeSubmit(event) {
    event.preventDefault();
    setError(null);
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
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setChallenge("");
    setCode("");
    setCodeMode("app");
    setError(null);
    setPassword("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const errors = validateAuthForm({ mode, name, email, password });
    setFieldErrors(errors);
    setTouched({ name: true, email: true, password: true });
    const firstBad = ["name", "email", "password"].find((f) => errors[f]);
    if (firstBad) {
      document.getElementById(firstBad)?.focus();
      return;
    }
    setBusy(true);
    try {
      // Soft upgrade: present Guest credential is claimed + retired on the server.
      const guestCred = guestCredential || null;
      const data =
        mode === "login"
          ? await login({ email: email.trim(), password, guestCredential: guestCred })
          : await register({
              email: email.trim(),
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
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleContinueAsGuest() {
    enterGuestMode();
    navigate(pathAfterAuth(from, "/queues"), { replace: true });
  }

  if (mode === "login" && challenge) {
    const complete = codeLooksComplete(code, codeMode);
    return (
      <div className="w-full" data-testid="two-step-form">
        <span className="mb-5 grid size-11 place-items-center rounded-xl bg-primary-muted text-primary" aria-hidden="true">
          <ShieldCheck className="size-5" />
        </span>
        <AuthHeading
          title={t("auth.codeTitle")}
          intro={codeMode === "app" ? t("auth.codeIntro") : t("auth.backupIntro")}
        />
        <form className="mt-8 flex flex-col gap-5" onSubmit={handleCodeSubmit} aria-busy={busy || undefined}>
          <AuthField
            id="two-step-code"
            label={codeMode === "app" ? t("auth.codeLabel") : t("auth.backupLabel")}
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
            className="text-center font-mono text-xl tracking-[0.35em] md:text-xl"
            data-testid="two-step-code"
          />
          {error ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <AuthErrorAlert info={error} testId="two-step-error" />
            </div>
          ) : null}
          <AuthSubmit
            busy={busy}
            disabled={!complete}
            label={t("auth.verify")}
            busyLabel={t("auth.verifying")}
            data-testid="two-step-submit"
          />
        </form>
        <div className="mt-6 flex flex-col items-center gap-3 text-sm">
          <button
            type="button"
            className={linkClass}
            onClick={() => {
              setCodeMode((m) => (m === "app" ? "backup" : "app"));
              setCode("");
              setError(null);
            }}
            data-testid="two-step-toggle"
          >
            {codeMode === "app" ? t("auth.useBackup") : t("auth.useApp")}
          </button>
          <button
            type="button"
            className="rounded-sm text-text-secondary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={startOver}
          >
            {t("auth.startOver")}
          </button>
        </div>
      </div>
    );
  }

  const isLogin = mode === "login";
  return (
    <div className="w-full">
      {notice ? (
        <Alert className="mb-6 text-sm" data-testid="auth-notice">
          {notice}
        </Alert>
      ) : null}
      <AuthHeading
        eyebrow={isLogin ? t("auth.welcomeBack") : t("auth.newHere")}
        title={isLogin ? t("auth.login") : t("auth.register")}
        intro={isLogin ? t("auth.subtitle") : t("auth.registerIntro")}
      />

      {isGuest ? (
        <div
          className="mt-5 flex gap-3 rounded-lg border border-primary/25 bg-primary-muted/50 px-3.5 py-3"
          data-testid="soft-upgrade-auth-hint"
        >
          <UserRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">{t("auth.keepHistory")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{t("auth.keepHistoryBody")}</p>
          </div>
        </div>
      ) : null}

      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={busy || undefined}
        data-testid={`${mode}-form`}
      >
        {mode === "register" && (
          <AuthField
            id="name"
            label={t("auth.name")}
            error={touched.name ? fieldErrors.name : ""}
            type="text"
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            value={name}
            onChange={onChangeField("name", setName)}
            onBlur={(e) => onBlurField("name", e.target.value)}
            placeholder={t("auth.namePlaceholder")}
            data-testid="register-name"
          />
        )}
        <AuthField
          id="email"
          label={t("auth.email")}
          error={touched.email ? fieldErrors.email : ""}
          type="email"
          name="email"
          inputMode="email"
          autoComplete={isLogin ? "username" : "email"}
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          onChange={onChangeField("email", setEmail)}
          onBlur={(e) => onBlurField("email", e.target.value)}
          placeholder="you@example.com"
        />
        <PasswordField
          id="password"
          label={t("auth.password")}
          error={touched.password ? fieldErrors.password : ""}
          hint={isLogin ? "" : t("auth.passwordHint")}
          name="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          required
          minLength={isLogin ? undefined : 8}
          maxLength={128}
          value={password}
          onChange={onChangeField("password", setPassword)}
          onBlur={(e) => onBlurField("password", e.target.value)}
          trailing={
            isLogin ? (
              <Link to="/forgot-password" className={`${linkClass} text-sm`} data-testid="forgot-password-link">
                {t("auth.forgotLink")}
              </Link>
            ) : null
          }
        />

        {error ? (
          <div ref={errorRef} tabIndex={-1} className="outline-none">
            <AuthErrorAlert info={error} />
          </div>
        ) : null}

        <AuthSubmit
          busy={busy}
          label={isLogin ? t("auth.login") : t("auth.createAccount")}
          busyLabel={isLogin ? t("auth.signingIn") : t("auth.creatingAccount")}
          data-testid="auth-submit"
        />
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        {isLogin ? (
          <>
            {t("auth.noAccount")}{" "}
            <Link to="/register" className={linkClass} data-testid="register-link">
              {t("auth.register")}
            </Link>
          </>
        ) : (
          <>
            {t("auth.alreadyRegistered")}{" "}
            <Link to="/login" className={linkClass} data-testid="login-link">
              {t("auth.login")}
            </Link>
          </>
        )}
      </p>

      {!isGuest ? (
        <div className="mt-7 flex flex-col gap-4">
          <AuthDivider label={t("auth.or")} />
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-12 w-full rounded-lg border border-border text-[0.9375rem] font-semibold"
            onClick={handleContinueAsGuest}
            data-testid="continue-as-guest"
          >
            {t("auth.continueGuest")}
          </Button>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
            <QrCode className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{t("auth.qrHint")}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

