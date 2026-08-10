import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  fetchAnalytics,
  fetchHistory,
  fetchMe,
  fetchQueues,
  fetchQueueStatus,
  fetchWaitingList,
  joinQueue,
  leaveQueue,
  login,
  pauseQueue,
  resetQueue,
  resumeQueue,
  serveQueue,
  skipQueue,
  startAcceptingTokens,
  stopAcceptingTokens,
  extendAcceptingSession,
  updateServiceWindows,
  walkInQueue,
  API_URL,
} from "@/api";
import { createRealtimeClient } from "@/lib/realtime";

export const TOKEN_KEY = "queueit_token";
/** Device-bound Guest credential (survives refresh on this browser). */
export const GUEST_CREDENTIAL_KEY = "queueit_guest_credential";
/** Client flag: entered student path as Guest before first join. */
export const GUEST_MODE_KEY = "queueit_guest_mode";
/** Session flag: show one-shot soft-upgrade reinforce after Guest leave. */
export const SOFT_UPGRADE_POST_LEAVE_KEY = "queueit_soft_upgrade_post_leave";
/** Poll interval for live status and admin waiting list (safe fallback baseline). */
const STATUS_POLL_MS = 3000;

const AppContext = createContext(null);

function readStoredGuestCredential() {
  return localStorage.getItem(GUEST_CREDENTIAL_KEY) || "";
}

function readStoredGuestMode() {
  return localStorage.getItem(GUEST_MODE_KEY) === "1";
}

export function AppProvider({ children }) {
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

  const [queues, setQueues] = useState([]);
  const [queuesLoading, setQueuesLoading] = useState(false);
  const [queuesError, setQueuesError] = useState("");
  const [selectedQueueId, setSelectedQueueId] = useState(null);

  const [liveStatus, setLiveStatus] = useState(null);
  const [statusQueueId, setStatusQueueId] = useState(null);
  /** Wall-clock ms of last successful live status payload (join / poll / restore). */
  const [statusLastUpdatedAt, setStatusLastUpdatedAt] = useState(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [adminQueueId, setAdminQueueId] = useState(null);
  const [adminQueueMeta, setAdminQueueMeta] = useState(null);
  const [waitingList, setWaitingList] = useState([]);
  const [waitingLoading, setWaitingLoading] = useState(false);
  const [waitingError, setWaitingError] = useState("");
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [adminActionError, setAdminActionError] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState(null);

  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  const pollRef = useRef(null);
  const adminPollRef = useRef(null);

  /** Socket.IO client for the current session (null when logged out). */
  const realtimeRef = useRef(null);
  const statusQueueIdRef = useRef(null);
  const adminQueueIdRef = useRef(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Keep refs in sync so the socket's queue:changed handler always targets the
  // current rooms without re-creating the socket on every state change.
  useEffect(() => {
    statusQueueIdRef.current = statusQueueId;
    adminQueueIdRef.current = adminQueueId;
  }, [statusQueueId, adminQueueId]);

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

  const clearLiveStatus = useCallback(() => {
    setLiveStatus(null);
    setStatusQueueId(null);
    setStatusLastUpdatedAt(null);
    setJoinError("");
    setStatusError("");
    setStatusUpdating(false);
    setLeaveError("");
    setLeaveBusy(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearAdminConsole = useCallback(() => {
    setAdminQueueId(null);
    setAdminQueueMeta(null);
    setWaitingList([]);
    setWaitingError("");
    setWaitingLoading(false);
    setAdminActionError("");
    setAdminActionBusy(false);
    setSelectedEntryId(null);
    if (adminPollRef.current) {
      clearInterval(adminPollRef.current);
      adminPollRef.current = null;
    }
  }, []);

  /**
   * Log out JWT User/Admin. Unclaimed Guest credential may still power Guest path.
   */
  const logout = useCallback(() => {
    persistSession("", null);
    setQueues([]);
    setQueuesError("");
    setQueuesLoading(false);
    setSelectedQueueId(null);
    setHistoryEvents([]);
    setHistoryError("");
    setHistoryLoading(false);
    setAnalyticsData(null);
    setAnalyticsError("");
    setAnalyticsLoading(false);
    clearLiveStatus();
    clearAdminConsole();
  }, [persistSession, clearLiveStatus, clearAdminConsole]);

  /** JWT when present; else Guest credential for student join APIs. */
  const joinerAuth = useCallback(() => {
    if (token) return { token, guestCredential: null };
    return { token: null, guestCredential: guestCredential || null };
  }, [token, guestCredential]);

  const restoreActiveMembership = useCallback(async (sessionToken, catalog, guestCred) => {
    if ((!sessionToken && !guestCred) || !Array.isArray(catalog)) return false;
    for (const queue of catalog) {
      try {
        const data = await fetchQueueStatus(sessionToken, queue.id, guestCred);
        setLiveStatus(data);
        setStatusQueueId(queue.id);
        setStatusLastUpdatedAt(Date.now());
        setStatusError("");
        return true;
      } catch {
        // Not in this queue — try next.
      }
    }
    return false;
  }, []);

  const loadQueues = useCallback(
    async (sessionToken, { restoreStatus = false, guestCred } = {}) => {
      setQueuesLoading(true);
      setQueuesError("");
      try {
        const data = await fetchQueues(sessionToken, guestCred);
        const catalog = Array.isArray(data.queues) ? data.queues : [];
        setQueues(catalog);
        if (restoreStatus) {
          await restoreActiveMembership(sessionToken, catalog, guestCred);
        }
      } catch (err) {
        setQueues([]);
        setQueuesError(err.message || "Could not load queues");
      } finally {
        setQueuesLoading(false);
      }
    },
    [restoreActiveMembership]
  );

  const refreshStatus = useCallback(
    async (sessionToken, queueId, { silent, guestCred } = {}) => {
      if ((!sessionToken && !guestCred) || !queueId) return;
      if (!silent) setStatusUpdating(true);
      try {
        const data = await fetchQueueStatus(sessionToken, queueId, guestCred);
        setLiveStatus(data);
        setStatusQueueId(queueId);
        setStatusLastUpdatedAt(Date.now());
        setStatusError("");
      } catch (err) {
        if (err.status === 404) {
          clearLiveStatus();
          return;
        }
        setStatusError(err.message || "Could not refresh status");
      } finally {
        if (!silent) setStatusUpdating(false);
      }
    },
    [clearLiveStatus]
  );

  // Restore JWT session or Guest path on boot.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (token) {
        try {
          const data = await fetchMe(token);
          if (cancelled) return;
          setUser(data.user);
          if (!cancelled) {
            await loadQueues(token, { restoreStatus: true });
          }
        } catch {
          if (!cancelled) {
            logout();
          }
        } finally {
          if (!cancelled) setBooting(false);
        }
        return;
      }

      // Guest path: mode and/or stored credential (no JWT).
      if (guestMode || guestCredential) {
        try {
          await loadQueues(null, {
            restoreStatus: Boolean(guestCredential),
            guestCred: guestCredential || null,
          });
        } catch {
          // Catalog errors surface via queuesError.
        } finally {
          if (!cancelled) setBooting(false);
        }
        return;
      }

      if (!cancelled) setBooting(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [token, guestMode, guestCredential, logout, loadQueues]);

  const loadWaitingList = useCallback(
    async (sessionToken, queueId, { silent } = {}) => {
      if (!sessionToken || !queueId) return;
      if (!silent) setWaitingLoading(true);
      try {
        const data = await fetchWaitingList(sessionToken, queueId);
        setAdminQueueMeta(data.queue || null);
        setWaitingList(Array.isArray(data.waiting) ? data.waiting : []);
        setWaitingError("");
        setAdminQueueId(queueId);
      } catch (err) {
        setWaitingError(err.message || "Could not load waiting list");
      } finally {
        if (!silent) setWaitingLoading(false);
      }
    },
    []
  );

  // Realtime lifecycle: Socket.IO is JWT-only (F16 Guest credential out).
  // Guest path relies on polling honesty as the live baseline.
  useEffect(() => {
    if (!token) {
      if (realtimeRef.current) {
        realtimeRef.current.disconnect();
        realtimeRef.current = null;
        setRealtimeConnected(false);
      }
      return undefined;
    }

    const client = createRealtimeClient({
      url: API_URL,
      token,
      onStatusChange: (connected) => setRealtimeConnected(connected),
      onQueueChanged: ({ queueId }) => {
        if (queueId === statusQueueIdRef.current) {
          refreshStatus(token, statusQueueIdRef.current, { silent: true });
        }
        if (queueId === adminQueueIdRef.current) {
          loadWaitingList(token, adminQueueIdRef.current, { silent: true });
        }
      },
    });
    realtimeRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      if (realtimeRef.current === client) realtimeRef.current = null;
      setRealtimeConnected(false);
    };
  }, [token, refreshStatus, loadWaitingList]);

  // Subscribe the socket to the rooms matching the open surfaces.
  useEffect(() => {
    const client = realtimeRef.current;
    if (!client) return;
    const targets = [statusQueueId, adminQueueId].filter(Boolean);
    client.setSubscriptions(targets);
  }, [statusQueueId, adminQueueId]);

  const loadHistory = useCallback(async (sessionToken, guestCred) => {
    if (!sessionToken && !guestCred) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await fetchHistory(sessionToken, guestCred);
      setHistoryEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setHistoryEvents([]);
      setHistoryError(err.message || "Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  /**
   * Load ops analytics for one queue (served count, average wait, busy hours).
   * Admin-only route; refreshed on mount and by the Refresh button.
   */
  const loadAnalytics = useCallback(async (sessionToken, queueId) => {
    if (!sessionToken || !queueId) return;
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      const data = await fetchAnalytics(sessionToken, queueId);
      setAnalyticsData(data);
    } catch (err) {
      setAnalyticsData(null);
      setAnalyticsError(err.message || "Could not load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // Poll live status while the joiner holds a place in line (User JWT or Guest).
  useEffect(() => {
    const auth = joinerAuth();
    if ((!auth.token && !auth.guestCredential) || !statusQueueId || !liveStatus) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      refreshStatus(auth.token, statusQueueId, {
        silent: true,
        guestCred: auth.guestCredential,
      });
    }, STATUS_POLL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [token, guestCredential, statusQueueId, liveStatus, refreshStatus, joinerAuth]);

  // Poll admin waiting list while the console is open.
  useEffect(() => {
    if (!token || !adminQueueId || user?.role !== "admin") {
      if (adminPollRef.current) {
        clearInterval(adminPollRef.current);
        adminPollRef.current = null;
      }
      return;
    }

    adminPollRef.current = setInterval(() => {
      loadWaitingList(token, adminQueueId, { silent: true });
    }, STATUS_POLL_MS);

    return () => {
      if (adminPollRef.current) {
        clearInterval(adminPollRef.current);
        adminPollRef.current = null;
      }
    };
  }, [token, adminQueueId, user?.role, loadWaitingList]);

  const join = useCallback(
    async (queueId) => {
      if (!queueId) return false;
      // JWT User/Admin, existing Guest credential, or mint on first Guest join.
      const auth = joinerAuth();
      if (user?.role === "admin") return false;
      setJoinError("");
      setJoinBusy(true);
      try {
        const data = await joinQueue(auth.token, queueId, auth.guestCredential);
        if (data.guestCredential) {
          persistGuestCredential(data.guestCredential);
        }
        setLiveStatus(data);
        setStatusQueueId(queueId);
        setStatusLastUpdatedAt(Date.now());
        setStatusError("");
        return true;
      } catch (err) {
        // Already waiting — resume live status instead of a dead-end error.
        if (err.status === 409) {
          try {
            await refreshStatus(auth.token, queueId, {
              guestCred: auth.guestCredential,
            });
            return true;
          } catch {
            // fall through to message
          }
        }
        setJoinError(err.message || "Could not join queue");
        return false;
      } finally {
        setJoinBusy(false);
      }
    },
    [joinerAuth, user?.role, refreshStatus, persistGuestCredential]
  );

  const leave = useCallback(async () => {
    const auth = joinerAuth();
    if ((!auth.token && !auth.guestCredential) || !statusQueueId) return false;
    setLeaveError("");
    setLeaveBusy(true);
    try {
      await leaveQueue(auth.token, statusQueueId, auth.guestCredential);
      // Optional post-leave soft-upgrade reinforce (Guest only; not a banner).
      if (!auth.token && auth.guestCredential) {
        try {
          sessionStorage.setItem(SOFT_UPGRADE_POST_LEAVE_KEY, "1");
        } catch {
          // Private mode / blocked storage — skip reinforce.
        }
      }
      clearLiveStatus();
      setSelectedQueueId(null);
      return true;
    } catch (err) {
      if (err.status === 404) {
        clearLiveStatus();
        return true;
      }
      setLeaveError(err.message || "Could not leave queue");
      return false;
    } finally {
      setLeaveBusy(false);
    }
  }, [joinerAuth, statusQueueId, clearLiveStatus]);

  const openAdminConsole = useCallback(
    async (queueId) => {
      if (!token || !queueId) return;
      setSelectedQueueId(queueId);
      setSelectedEntryId(null);
      setAdminActionError("");
      await loadWaitingList(token, queueId);
    },
    [token, loadWaitingList]
  );

  /**
   * Run one admin control action with shared busy/error/reload handling.
   * @param {() => Promise<unknown>} action
   * @param {string} errorLabel
   * @param {{ clearSelection?: boolean }} [options]
   */
  const runAdminAction = useCallback(
    async (action, errorLabel, { clearSelection = false } = {}) => {
      if (!token || !adminQueueId) return false;
      setAdminActionError("");
      setAdminActionBusy(true);
      try {
        await action();
        if (clearSelection) setSelectedEntryId(null);
        await loadWaitingList(token, adminQueueId, { silent: true });
        return true;
      } catch (err) {
        setAdminActionError(err.message || errorLabel);
        return false;
      } finally {
        setAdminActionBusy(false);
      }
    },
    [token, adminQueueId, loadWaitingList]
  );

  const adminServe = useCallback(
    (entryId) =>
      runAdminAction(
        () => serveQueue(token, adminQueueId, entryId || undefined),
        "Serve failed",
        { clearSelection: true }
      ),
    [token, adminQueueId, runAdminAction]
  );

  const adminSkip = useCallback(
    (entryId) =>
      runAdminAction(
        () => skipQueue(token, adminQueueId, entryId || undefined),
        "Skip failed",
        { clearSelection: true }
      ),
    [token, adminQueueId, runAdminAction]
  );

  const adminPause = useCallback(
    () => runAdminAction(() => pauseQueue(token, adminQueueId), "Pause failed"),
    [token, adminQueueId, runAdminAction]
  );

  const adminResume = useCallback(
    () => runAdminAction(() => resumeQueue(token, adminQueueId), "Resume failed"),
    [token, adminQueueId, runAdminAction]
  );

  /** Stop accepting tokens (Closed + drain). Orthogonal to Pause. */
  const adminStopAccepting = useCallback(
    (opts = {}) =>
      runAdminAction(
        () => stopAcceptingTokens(token, adminQueueId, opts),
        "Stop accepting failed"
      ),
    [token, adminQueueId, runAdminAction]
  );

  /** Start accepting tokens again after Closed. Binds target window. Does not unpause. */
  const adminStartAccepting = useCallback(
    () =>
      runAdminAction(
        () => startAcceptingTokens(token, adminQueueId),
        "Start accepting failed"
      ),
    [token, adminQueueId, runAdminAction]
  );

  /**
   * Extend auto-close while accepting tokens.
   * @param {{ minutes?: 15|30, endsAt?: string }} payload
   */
  const adminExtend = useCallback(
    (payload) =>
      runAdminAction(
        () => extendAcceptingSession(token, adminQueueId, payload),
        "Extend failed"
      ),
    [token, adminQueueId, runAdminAction]
  );

  /**
   * Replace daily service windows (campus IST HH:mm).
   * @param {{ start: string, end: string }[]} serviceWindows
   */
  const adminUpdateServiceWindows = useCallback(
    (serviceWindows) =>
      runAdminAction(
        () => updateServiceWindows(token, adminQueueId, serviceWindows),
        "Update service windows failed"
      ),
    [token, adminQueueId, runAdminAction]
  );

  /**
   * Reset the queue for end-of-session / day close: clears the waiting list,
   * resets now serving + tokens, re-opens advancement. Not start-accepting.
   */
  const adminReset = useCallback(
    () => runAdminAction(() => resetQueue(token, adminQueueId), "Reset failed"),
    [token, adminQueueId, runAdminAction]
  );

  /**
   * Add a walk-in waiter (counter arrival without app join).
   * @param {{ name: string, tokenNumber?: number|string }} payload
   * @returns {Promise<boolean>}
   */
  const adminWalkIn = useCallback(
    async ({ name, tokenNumber } = {}) => {
      if (!token || !adminQueueId) return false;
      setAdminActionError("");
      setAdminActionBusy(true);
      try {
        await walkInQueue(token, adminQueueId, { name, tokenNumber });
        await loadWaitingList(token, adminQueueId, { silent: true });
        return true;
      } catch (err) {
        setAdminActionError(err.message || "Walk-in failed");
        return false;
      } finally {
        setAdminActionBusy(false);
      }
    },
    [token, adminQueueId, loadWaitingList]
  );

  // Guest persona when no JWT User/Admin and (mode or credential) is present.
  const isGuest = !user && (guestMode || Boolean(guestCredential));

  const value = {
    token,
    user,
    guestCredential,
    guestMode,
    isGuest,
    booting,
    isAdmin: user?.role === "admin",
    persistSession,
    persistGuestCredential,
    enterGuestMode,
    queues,
    queuesLoading,
    queuesError,
    selectedQueueId,
    setSelectedQueueId,
    setJoinError,
    loadQueues,
    refreshQueues: loadQueues,
    liveStatus,
    statusQueueId,
    statusLastUpdatedAt,
    inQueue: Boolean(liveStatus && statusQueueId),
    joinBusy,
    joinError,
    statusError,
    statusUpdating,
    leaveBusy,
    leaveError,
    join,
    leave,
    refreshStatus,
    historyEvents,
    historyLoading,
    historyError,
    loadHistory,
    adminQueueId,
    adminQueueMeta,
    waitingList,
    waitingLoading,
    waitingError,
    adminActionBusy,
    adminActionError,
    selectedEntryId,
    setSelectedEntryId,
    openAdminConsole,
    clearAdminConsole,
    adminServe,
    adminSkip,
    adminPause,
    adminResume,
    adminStopAccepting,
    adminStartAccepting,
    adminExtend,
    adminUpdateServiceWindows,
    adminReset,
    adminWalkIn,
    realtimeConnected,
    analyticsData,
    analyticsLoading,
    analyticsError,
    loadAnalytics,
    logout,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return ctx;
}
