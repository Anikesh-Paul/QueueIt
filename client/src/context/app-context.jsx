import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  fetchHistory,
  fetchMe,
  fetchQueues,
  fetchQueueStatus,
  fetchWaitingList,
  joinQueue,
  leaveQueue,
  login,
  pauseQueue,
  resumeQueue,
  serveQueue,
  skipQueue,
} from "@/api";

export const TOKEN_KEY = "queueit_token";
/** Poll interval for live status and admin waiting list (must-ship path; no Socket.IO). */
const STATUS_POLL_MS = 3000;

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

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

  const pollRef = useRef(null);
  const adminPollRef = useRef(null);

  const persistSession = useCallback((nextToken, nextUser) => {
    setToken(nextToken);
    setUser(nextUser);
    if (nextToken) {
      localStorage.setItem(TOKEN_KEY, nextToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
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

  const logout = useCallback(() => {
    persistSession("", null);
    setQueues([]);
    setQueuesError("");
    setQueuesLoading(false);
    setSelectedQueueId(null);
    setHistoryEvents([]);
    setHistoryError("");
    setHistoryLoading(false);
    clearLiveStatus();
    clearAdminConsole();
  }, [persistSession, clearLiveStatus, clearAdminConsole]);

  const restoreActiveMembership = useCallback(async (sessionToken, catalog) => {
    if (!sessionToken || !Array.isArray(catalog)) return false;
    for (const queue of catalog) {
      try {
        const data = await fetchQueueStatus(sessionToken, queue.id);
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
    async (sessionToken, { restoreStatus = false } = {}) => {
      setQueuesLoading(true);
      setQueuesError("");
      try {
        const data = await fetchQueues(sessionToken);
        const catalog = Array.isArray(data.queues) ? data.queues : [];
        setQueues(catalog);
        if (restoreStatus) {
          await restoreActiveMembership(sessionToken, catalog);
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
    async (sessionToken, queueId, { silent } = {}) => {
      if (!sessionToken || !queueId) return;
      if (!silent) setStatusUpdating(true);
      try {
        const data = await fetchQueueStatus(sessionToken, queueId);
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

  // Restore session on boot (and after re-login).
  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }

    let cancelled = false;
    (async () => {
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
    })();

    return () => {
      cancelled = true;
    };
  }, [token, logout, loadQueues]);

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

  const loadHistory = useCallback(async (sessionToken) => {
    if (!sessionToken) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await fetchHistory(sessionToken);
      setHistoryEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setHistoryEvents([]);
      setHistoryError(err.message || "Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Poll live status while the user holds a place in line.
  useEffect(() => {
    if (!token || !statusQueueId || !liveStatus) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      refreshStatus(token, statusQueueId, { silent: true });
    }, STATUS_POLL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [token, statusQueueId, liveStatus, refreshStatus]);

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
      if (!token || !queueId) return false;
      setJoinError("");
      setJoinBusy(true);
      try {
        const data = await joinQueue(token, queueId);
        setLiveStatus(data);
        setStatusQueueId(queueId);
        setStatusLastUpdatedAt(Date.now());
        setStatusError("");
        return true;
      } catch (err) {
        // Already waiting — resume live status instead of a dead-end error.
        if (err.status === 409) {
          try {
            await refreshStatus(token, queueId);
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
    [token, refreshStatus]
  );

  const leave = useCallback(async () => {
    if (!token || !statusQueueId) return false;
    setLeaveError("");
    setLeaveBusy(true);
    try {
      await leaveQueue(token, statusQueueId);
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
  }, [token, statusQueueId, clearLiveStatus]);

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
      if (!token || !adminQueueId) return;
      setAdminActionError("");
      setAdminActionBusy(true);
      try {
        await action();
        if (clearSelection) setSelectedEntryId(null);
        await loadWaitingList(token, adminQueueId, { silent: true });
      } catch (err) {
        setAdminActionError(err.message || errorLabel);
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

  const value = {
    token,
    user,
    booting,
    isAdmin: user?.role === "admin",
    persistSession,
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
