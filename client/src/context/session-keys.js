export const TOKEN_KEY = "queueit_token";
/**
 * Device-bound Guest credential (survives refresh on this browser).
 * Stored in localStorage alongside the JWT — convenient, but XSS on this origin
 * can read it. The API stores only a hash of this secret.
 */
export const GUEST_CREDENTIAL_KEY = "queueit_guest_credential";
/** Client flag: entered student path as Guest before first join. */
export const GUEST_MODE_KEY = "queueit_guest_mode";
/** Session flag: show one-shot soft-upgrade reinforce after Guest leave. */
export const SOFT_UPGRADE_POST_LEAVE_KEY = "queueit_soft_upgrade_post_leave";

export function readStoredGuestCredential() {
  return localStorage.getItem(GUEST_CREDENTIAL_KEY) || "";
}

export function readStoredGuestMode() {
  return localStorage.getItem(GUEST_MODE_KEY) === "1";
}
