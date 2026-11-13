import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, KeyRound, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShellContent } from "@/components/shell/shell-content";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import {
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  logoutAllDevices,
  regenerateBackupCodes,
  startTwoFactorSetup,
} from "@/api";
import { backupCodesFile, cleanCode, groupSecret, isAuthenticatorCode } from "@/lib/two-factor";
import { formatCampusDateTime } from "@/lib/campus-time";
import { peekAuthFlash, setAuthFlash, takeAuthFlashNotice } from "@/lib/auth-flash";

const FIELD =
  "h-11 rounded-md border-border bg-background/60 px-3.5 text-[0.9375rem] shadow-none focus-visible:border-primary focus-visible:bg-card";
const CARD = "rounded-xl border border-border bg-card p-5 shadow-card sm:p-6";

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shown once after enrolling or making new codes. */
function BackupCodes({ codes, email, onDone }) {
  const [copied, setCopied] = useState(false);
  return (
    <div data-testid="backup-codes" className="mt-4">
      <p className="text-sm font-semibold text-foreground">Save your backup codes</p>
      <p className="mt-1 text-sm text-text-secondary">
        If you lose your phone, each of these codes signs you in once. This is the only time they are shown.
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-background p-3 font-mono text-sm text-foreground">
        {codes.map((code) => (
          <li key={code} data-testid="backup-code">
            {code}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join("\n"));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadText("queueit-backup-codes.txt", backupCodesFile(codes, { email }))}
        >
          <Download aria-hidden="true" /> Download
        </Button>
        <Button size="sm" onClick={onDone} data-testid="backup-codes-done">
          I’ve saved them
        </Button>
      </div>
    </div>
  );
}

function CodeField({ id, label, value, onChange, testId, allowBackup = false }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-label text-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="one-time-code"
        inputMode={allowBackup ? "text" : "numeric"}
        maxLength={allowBackup ? 11 : 7}
        placeholder={allowBackup ? "123456 or xxxxx-xxxxx" : "123456"}
        className={`${FIELD} font-mono tracking-[0.15em]`}
        data-testid={testId}
      />
    </div>
  );
}

/** Two-step sign-in management for admin and staff accounts. */
function TwoFactorCard({ token, user }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [stage, setStage] = useState("idle"); // idle | password | scan | codes | disable | regen
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchTwoFactorStatus(token);
      setStatus(data.twoFactor);
      setLoadError("");
    } catch (err) {
      setLoadError(err.message || "Could not load two-step sign-in");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function reset(next = "idle") {
    setStage(next);
    setPassword("");
    setCode("");
    setError("");
    if (next === "idle") setSetup(null);
  }

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <Alert variant="destructive">{loadError}</Alert>;
  if (!status) return <p className="text-sm text-text-muted">Loading…</p>;
  const enabled = status.enabled;

  return (
    <section className={CARD} aria-labelledby="two-step-heading" data-testid="two-step-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="two-step-heading" className="font-heading text-lg font-semibold text-foreground">
            Two-step sign-in
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            After your password, QueueIt asks for a 6-digit code from an authenticator app such as Google
            Authenticator, Microsoft Authenticator or 1Password.
          </p>
        </div>
        <Badge variant={enabled ? "default" : "secondary"} data-testid="two-step-state">
          {enabled ? "On" : "Off"}
        </Badge>
      </div>

      {enabled && stage !== "codes" ? (
        <p className="mt-3 text-sm text-text-secondary" data-testid="two-step-summary">
          {status.enabledAt ? `On since ${formatCampusDateTime(status.enabledAt)}. ` : ""}
          {status.backupCodesRemaining != null
            ? `${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? "" : "s"} left.`
            : ""}
        </p>
      ) : null}

      {stage === "idle" && !enabled ? (
        <Button className="mt-4" onClick={() => reset("password")} data-testid="two-step-start">
          <ShieldCheck aria-hidden="true" /> Set up two-step sign-in
        </Button>
      ) : null}

      {stage === "idle" && enabled ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => reset("regen")} data-testid="two-step-regen">
            <KeyRound aria-hidden="true" /> New backup codes
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => reset("disable")}
            data-testid="two-step-disable"
          >
            <ShieldOff aria-hidden="true" /> Turn off
          </Button>
        </div>
      ) : null}

      {stage === "password" ? (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const data = await startTwoFactorSetup(token, password);
              setSetup(data);
              setPassword("");
              setStage("scan");
            });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="two-step-password" className="text-label text-foreground">
              Confirm your password
            </Label>
            <Input
              id="two-step-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
              data-testid="two-step-password"
            />
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !password} data-testid="two-step-continue">
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {stage === "scan" && setup ? (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const data = await enableTwoFactor(token, cleanCode(code));
              setCodes(data.backupCodes || []);
              setStatus(data.twoFactor);
              setCode("");
              setStage("codes");
            });
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this QR code, or type the key by hand.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="rounded-lg border border-border bg-white p-3" data-testid="two-step-qr">
              <QRCodeSVG value={setup.otpauthUrl} size={168} level="M" title="QueueIt two-step sign-in QR code" />
            </div>
            <div className="min-w-0">
              <p className="text-label text-text-muted">Key</p>
              <p className="mt-1 break-all font-mono text-sm text-foreground" data-testid="two-step-secret">
                {groupSecret(setup.secret)}
              </p>
              <p className="mt-1 text-xs text-text-muted">Time-based, 6 digits, every 30 seconds.</p>
            </div>
          </div>
          <CodeField id="two-step-confirm" label="6-digit code" value={code} onChange={setCode} testId="two-step-confirm-code" />
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !isAuthenticatorCode(code)} data-testid="two-step-enable">
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {stage === "codes" ? (
        <BackupCodes
          codes={codes}
          email={user?.email}
          onDone={() => {
            setCodes([]);
            reset();
            load();
          }}
        />
      ) : null}

      {stage === "disable" || stage === "regen" ? (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              if (stage === "disable") {
                const data = await disableTwoFactor(token, code.trim());
                setStatus(data.twoFactor);
                reset();
              } else {
                const data = await regenerateBackupCodes(token, code.trim());
                setCodes(data.backupCodes || []);
                setCode("");
                setStage("codes");
              }
            });
          }}
        >
          <p className="text-sm text-text-secondary">
            {stage === "disable"
              ? "To turn off two-step sign-in, enter a current code from your app or one of your backup codes."
              : "Enter a current code from your app. Your old backup codes will stop working."}
          </p>
          <CodeField
            id="two-step-current"
            label="Current code"
            value={code}
            onChange={setCode}
            testId="two-step-current-code"
            allowBackup
          />
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant={stage === "disable" ? "destructiveSolid" : "default"}
              disabled={busy || !code.trim()}
              data-testid="two-step-confirm-action"
            >
              {stage === "disable" ? "Turn off two-step sign-in" : "Make new codes"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** Account security: sign out everywhere (everyone) and two-step sign-in (admin/staff). */
export function SecurityPage() {
  const { token, user, isAdmin, logout } = useApp();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice] = useState(() => peekAuthFlash()?.notice || location.state?.notice || "");
  useEffect(() => {
    // Clear after reading (not inside the initializer: StrictMode runs it twice).
    takeAuthFlashNotice();
  }, []);
  const consoleRole = user?.role === "admin" || user?.role === "staff";

  async function signOutEverywhere() {
    setBusy(true);
    setError("");
    try {
      await logoutAllDevices(token);
      setAuthFlash({ notice: t("security.signedOutAll") });
      logout();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err.message || t("auth.requestFailed"));
      setBusy(false);
    }
  }

  return (
    <ShellContent tier={isAdmin ? "admin" : "student"} className="max-w-3xl">
      <h1
        className="font-display text-display font-semibold leading-tight tracking-[-0.01em] text-foreground"
        data-testid="security-heading"
      >
        {t("security.title")}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">{user?.email}</p>

      {notice ? (
        <Alert className="mt-5" data-testid="security-notice">
          {notice}
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-5">
        {consoleRole && token ? <TwoFactorCard token={token} user={user} /> : null}

        <section className={CARD} aria-labelledby="sign-out-all-heading">
          <h2 id="sign-out-all-heading" className="font-heading text-lg font-semibold text-foreground">
            {t("security.signOutAllTitle")}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{t("security.signOutAllBody")}</p>
          {error ? (
            <Alert variant="destructive" className="mt-3">
              {error}
            </Alert>
          ) : null}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="mt-4" disabled={busy} data-testid="sign-out-all">
                <LogOut aria-hidden="true" /> {t("security.signOutAllCta")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent data-testid="sign-out-all-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("security.signOutAllConfirm")}</AlertDialogTitle>
                <AlertDialogDescription>{t("security.signOutAllConfirmBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                <AlertDialogCancel>{t("security.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructiveSolid" onClick={signOutEverywhere} data-testid="sign-out-all-confirm">
                  {t("security.signOutAllCta")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </div>
    </ShellContent>
  );
}
