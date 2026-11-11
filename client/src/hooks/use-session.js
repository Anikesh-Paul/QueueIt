import { useCallback, useState } from "react";
import {
  TOKEN_KEY,
  GUEST_CREDENTIAL_KEY,
  GUEST_MODE_KEY,
  readStoredGuestCredential,
  readStoredGuestMode,
} from "@/context/session-keys";

/**
 * Auth/session slice: JWT User/Admin, Guest credential, and persistence.
 * Boot and logout are composed in AppProvider because they touch other surfaces.
 */
export function useSession() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [guestCredential, setGuestCredential] = useState(() => readStoredGuestCredential());
  const [guestMode, setGuestMode] = useState(() => readStoredGuestMode());
  const [booting, setBooting] = useState(
    Boolean(
      localStorage.getItem(TOKEN_KEY) ||
        readStoredGuestCredential() ||
        readStoredGuestMode()
    )
  );

  /**
   * Persist JWT User/Admin session. When establishing a session, clears the
   * device Guest path (JWT wins; soft upgrade retires credential client-side).
   */
  const persistSession = useCallback((nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    if (nextToken) {
      localStorage.setItem(TOKEN_KEY, nextToken);
      // Soft upgrade / login: Guest credential no longer powers this device.
      setGuestCredential("");
      setGuestMode(false);
      localStorage.removeItem(GUEST_CREDENTIAL_KEY);
      localStorage.removeItem(GUEST_MODE_KEY);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, []);

  const persistGuestCredential = useCallback((credential) => {
    const value = credential || "";
    setGuestCredential(value);
    if (value) {
      localStorage.setItem(GUEST_CREDENTIAL_KEY, value);
      localStorage.setItem(GUEST_MODE_KEY, "1");
      setGuestMode(true);
    } else {
      localStorage.removeItem(GUEST_CREDENTIAL_KEY);
    }
  }, []);

  /** Enter student path as Guest without a User account (catalog before first join). */
  const enterGuestMode = useCallback(() => {
    localStorage.setItem(GUEST_MODE_KEY, "1");
    setGuestMode(true);
  }, []);

  /** JWT when present; else Guest credential for student join APIs. */
  const joinerAuth = useCallback(() => {
    if (token) return { token, guestCredential: null };
    return { token: null, guestCredential: guestCredential || null };
  }, [token, guestCredential]);

  // Guest persona when no JWT User/Admin and (mode or credential) is present.
  const isGuest = !user && (guestMode || Boolean(guestCredential));

  return {
    token,
    user,
    setUser,
    guestCredential,
    guestMode,
    booting,
    setBooting,
    persistSession,
    persistGuestCredential,
    enterGuestMode,
    joinerAuth,
    isGuest,
  };
}
