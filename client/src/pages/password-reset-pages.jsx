import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { AuthLayout, AuthSuccess } from "@/components/auth/auth-layout";
import { AuthErrorAlert, AuthField, AuthHeading, AuthSubmit, PasswordField } from "@/components/auth/auth-fields";
import { forgotPassword, resetPassword } from "@/api";
import { useApp } from "@/context/app-context";
import { clearOfflineStatusCache } from "@/lib/register-sw";
import { useI18n } from "@/context/i18n-context";
import { confirmError, describeAuthError, emailError, passwordError } from "@/lib/auth-validation";

const backLinkClass =
  "inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

function BackToLogin() {
  const { t } = useI18n();
  return (
    <p className="mt-8 text-center">
      <Link to="/login" className={backLinkClass} data-testid="back-to-login">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("forgot.back")}
      </Link>
    </p>
  );
}

function IconBadge({ icon: Icon }) {
  return (
    <span className="mb-5 grid size-11 place-items-center rounded-xl bg-primary-muted text-primary" aria-hidden="true">
      <Icon className="size-5" />
    </span>
  );
}

function useFocusOnError(error) {
  const ref = useRef(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return ref;
}

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorRef = useFocusOnError(error);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const bad = emailError(email);
    setFieldError(bad);
    if (bad) {
      document.getElementById("email")?.focus();
      return;
    }
    setBusy(true);
    try {
      await forgotPassword({ email: email.trim() });
      setDone(true);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="w-full">
        <IconBadge icon={MailCheck} />
        <AuthHeading title={t("forgot.title")} intro={t("forgot.intro")} />

        {done ? (
          <AuthSuccess title={t("forgot.sentTitle")} body={t("forgot.notice")} testId="forgot-password-sent" />
        ) : (
          <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate aria-busy={busy || undefined}>
            <AuthField
              id="email"
              label={t("auth.email")}
              error={fieldError}
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (fieldError) setFieldError(emailError(event.target.value));
              }}
              onBlur={(event) => event.target.value && setFieldError(emailError(event.target.value))}
              placeholder="you@example.com"
              data-testid="forgot-password-email"
            />
            {error ? (
              <div ref={errorRef} tabIndex={-1} className="outline-none">
                <AuthErrorAlert info={error} />
              </div>
            ) : null}
            <AuthSubmit
              busy={busy}
              label={t("forgot.submit")}
              busyLabel={t("forgot.sending")}
              data-testid="forgot-password-submit"
            />
          </form>
        )}

        <BackToLogin />
      </div>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const { persistSession, guestCredential } = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useFocusOnError(error);

  function validate(next = { password, confirm }) {
    const out = {};
    const p = passwordError(next.password, { mode: "reset" });
    if (p) out.password = p;
    const c = confirmError(next.password, next.confirm);
    if (c) out.confirm = c;
    return out;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    const bad = validate();
    setErrors(bad);
    if (bad.password || bad.confirm) {
      document.getElementById(bad.password ? "password" : "confirm-password")?.focus();
      return;
    }
    setBusy(true);
    try {
      const data = await resetPassword({
        token,
        password,
        guestCredential: guestCredential || null,
      });
      clearOfflineStatusCache();
      if (data.twoFactorRequired && data.challenge) {
        // New password set; two-step accounts still finish with a code.
        navigate("/login", { replace: true, state: { twoFactorChallenge: data.challenge } });
        return;
      }
      persistSession(data.token, data.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="w-full">
        <IconBadge icon={KeyRound} />
        <AuthHeading title={t("reset.title")} intro={t("reset.intro")} />

        {!token ? (
          <div className="mt-8" data-testid="reset-password-missing">
            <AuthErrorAlert info={{ kind: "error", key: "reset.missing", message: "" }} testId="reset-password-missing-alert" />
            <p className="mt-4 text-sm">
              <Link to="/forgot-password" className={backLinkClass}>
                {t("reset.requestNew")}
              </Link>
            </p>
          </div>
        ) : (
          <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} noValidate aria-busy={busy || undefined}>
            <PasswordField
              id="password"
              label={t("reset.newPassword")}
              error={errors.password || ""}
              hint={t("auth.passwordHint")}
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (errors.password || errors.confirm) setErrors(validate({ password: event.target.value, confirm }));
              }}
              data-testid="reset-password-input"
            />
            <PasswordField
              id="confirm-password"
              label={t("reset.confirmPassword")}
              error={errors.confirm || ""}
              name="confirm-password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                if (errors.confirm) setErrors(validate({ password, confirm: event.target.value }));
              }}
              onBlur={(event) => {
                if (event.target.value) setErrors(validate({ password, confirm: event.target.value }));
              }}
              data-testid="reset-password-confirm"
            />
            {error ? (
              <div ref={errorRef} tabIndex={-1} className="outline-none">
                <AuthErrorAlert info={error} />
              </div>
            ) : null}
            <AuthSubmit
              busy={busy}
              label={t("reset.submit")}
              busyLabel={t("reset.saving")}
              data-testid="reset-password-submit"
            />
          </form>
        )}

        <BackToLogin />
      </div>
    </AuthLayout>
  );
}
