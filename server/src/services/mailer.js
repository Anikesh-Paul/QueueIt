/**
 * Pluggable mailer. In development, and whenever no transport is plugged in,
 * password-reset mail is written to the server log and does not throw.
 *
 * A real provider is not enabled by default. To send mail later, set SMTP_*
 * (documented in README / .env.example) and supply a transport with
 * `setMailer(fn)`. Do not commit secrets.
 */

/** @type {null | ((payload: { to: string, resetUrl: string }) => Promise<unknown> | unknown)} */
let customSend = null;

export function setMailer(fn) {
  customSend = typeof fn === "function" ? fn : null;
}

export function resetMailer() {
  customSend = null;
}

export async function sendPasswordReset({ to, resetUrl }) {
  if (customSend) {
    await customSend({ to, resetUrl });
    return;
  }
  if (process.env.SMTP_HOST) {
    console.warn(
      "[queueit-mailer] SMTP_HOST is set but no transport is plugged in; logging the reset link instead."
    );
  }
  console.info(`[queueit-mailer] Password reset for ${to}: ${resetUrl}`);
}
