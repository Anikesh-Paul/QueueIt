import { useId, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/context/i18n-context";
import { capsLockOn } from "@/lib/auth-validation";
import { cn } from "@/lib/utils";

/**
 * Shared pieces for the sign-in, register, forgot and reset forms:
 * labelled fields with inline errors, a password field with show/hide and a
 * Caps Lock warning, a submit button with a loading state and an error alert.
 */
export const authFieldClass =
  "h-12 rounded-lg border-border-strong bg-card px-3.5 text-base shadow-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-text-muted hover:border-text-muted/60 focus-visible:border-primary md:text-[0.9375rem] dark:bg-background/40";

/** One label + input + hint/error. Passes everything else through to <Input>. */
export function AuthField({ id, label, error = "", hint = "", className, children, ...inputProps }) {
  const { t } = useI18n();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-label text-foreground">
        {label}
      </Label>
      {children ?? (
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(authFieldClass, className)}
          {...inputProps}
        />
      )}
      <FieldMessages error={error ? t(error) : ""} errorId={errorId} hint={hint} hintId={hintId} />
    </div>
  );
}

function FieldMessages({ error, errorId, hint, hintId, extra = null }) {
  if (!error && !hint && !extra) return null;
  return (
    <div className="flex flex-col gap-1">
      {error ? (
        <p id={errorId} className="auth-reveal flex items-start gap-1.5 text-sm font-medium text-destructive" data-testid={`${errorId}`}>
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
      {extra}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Password input with a show/hide toggle and a Caps Lock warning.
 * The toggle sits after the input in tab order and never submits the form.
 */
export function PasswordField({ id, label, error = "", hint = "", value, onChange, onBlur, className, trailing = null, ...rest }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsId = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, caps ? capsId : null, hint && !error ? hintId : null].filter(Boolean).join(" ") || undefined;

  function checkCaps(event) {
    setCaps(capsLockOn(event));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-label text-foreground">
          {label}
        </Label>
        {trailing}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(authFieldClass, "pr-12", className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-controls={id}
          title={t("auth.showPassword")}
          data-testid={`${id}-toggle`}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-text-secondary transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {visible ? <EyeOff className="size-[1.125rem]" aria-hidden="true" /> : <Eye className="size-[1.125rem]" aria-hidden="true" />}
          {/* Fixed name + aria-pressed: screen readers announce "Show password, toggle button, pressed". */}
          <span className="sr-only">{t("auth.showPassword")}</span>
        </button>
      </div>
      <FieldMessages
        error={error ? t(error) : ""}
        errorId={errorId}
        hint={hint}
        hintId={hintId}
        extra={
          caps ? (
            <p id={capsId} role="status" className="auth-reveal flex items-center gap-1.5 text-sm font-medium text-warning-ink" data-testid={`${id}-caps`}>
              <span className="rounded border border-current px-1 text-[0.625rem] font-bold leading-4" aria-hidden="true">
                ⇪
              </span>
              {t("auth.capsLock")}
            </p>
          ) : null
        }
      />
    </div>
  );
}

/** Primary submit with a spinner while busy. Keeps its width so nothing jumps. */
export function AuthSubmit({ busy, label, busyLabel, disabled = false, className, ...rest }) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className={cn(
        "group/submit mt-1 h-12 w-full gap-2 rounded-lg text-[0.9375rem] font-semibold shadow-card transition-[background-color,transform,box-shadow] active:translate-y-px",
        className
      )}
      {...rest}
    >
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="size-4 transition-transform group-hover/submit:translate-x-0.5" aria-hidden="true" />
        </>
      )}
    </Button>
  );
}

/**
 * Error box for a failed request. `info` comes from describeAuthError().
 * Lockouts get their own calmer "paused" look; it's not the user's typo.
 */
export function AuthErrorAlert({ info, testId = "auth-error", className }) {
  const { t } = useI18n();
  if (!info) return null;
  const text = info.key ? t(info.key) : info.message;
  const locked = info.kind === "locked";
  const Icon = locked ? Lock : info.kind === "offline" ? WifiOff : AlertCircle;
  return (
    <div
      role="alert"
      data-testid={testId}
      data-kind={info.kind}
      className={cn(
        "auth-reveal flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm",
        locked
          ? "border-warning-line bg-warning-soft text-warning-ink"
          : "border-destructive/30 bg-danger-soft text-danger-ink",
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{locked ? t("auth.lockedTitle") : info.kind === "offline" ? t("status.offlineTitle") : t("auth.errorTitle")}</p>
        <p className="mt-0.5 leading-snug">{text}</p>
      </div>
    </div>
  );
}

/** Page heading block shared by every auth screen. */
export function AuthHeading({ title, intro, eyebrow = null }) {
  return (
    <div>
      {eyebrow ? <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-primary uppercase">{eyebrow}</p> : null}
      <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-foreground">{title}</h1>
      {intro ? <p className="mt-2 text-[0.9375rem] leading-relaxed text-text-secondary">{intro}</p> : null}
    </div>
  );
}

/** "or" rule between the form and the guest option. */
export function AuthDivider({ label }) {
  return (
    <div className="flex items-center gap-3 text-xs font-medium text-text-secondary" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
