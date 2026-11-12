import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchActiveMemberships,
  fetchHistory,
  fetchQueues,
  fetchQueueStatus,
  joinQueue,
  leaveQueue,
} from "@/api";
import { resolveStatusPollMs } from "@/lib/poll-interval";
import { SOFT_UPGRADE_POST_LEAVE_KEY } from "@/context/session-keys";

/**
 * Student queue surface: catalog, live status, memberships, history, join/leave.
 */
export function useStudentQueue({
  token,
  user,
  guestCredential,
  joinerAuth,
  persistGuestCredential,
  tabHidden,
  realtimeConnected,
}) {
  const [queues, setQueues] = useState([]);
  const [queuesLoading, setQueuesLoading] = useState(false);
  /** False until the first memberships restore after this identity. */
  const [membershipsReady, setMembershipsReady] = useState(false);
  const [queuesError, setQueuesError] = useState("");
  const [selectedQueueId, setSelectedQueueId] = useState(null);

  const [liveStatus, setLiveStatus] = useState(null);
  const [statusQueueId, setStatusQueueId] = useState(null);
  /** All active memberships for this joiner (one per queue). */
  const [activeMemberships, setActiveMemberships] = useState([]);
  /** Wall-clock ms of last successful live status payload (join / poll / restore). */
  const [statusLastUpdatedAt, setStatusLastUpdatedAt] = useState(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusOffline, setStatusOffline] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  const pollRef = useRef(null);
  const statusQueueIdRef = useRef(null);
  const activeMembershipsRef = useRef([]);

  useEffect(() => {
    statusQueueIdRef.current = statusQueueId;
    activeMembershipsRef.current = activeMemberships;
  }, [statusQueueId, activeMemberships]);

  const clearLiveStatus = useCallback(() => {
    setLiveStatus(null);
    setStatusQueueId(null);
    setActiveMemberships([]);
    setStatusLastUpdatedAt(null);
    setJoinError("");
    setStatusError("");
    setStatusUpdating(false);
    setStatusOffline(false);
    setLeaveError("");
    setLeaveBusy(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearStudentSession = useCallback(() => {
    setQueues([]);
    setQueuesError("");
    setQueuesLoading(false);
    setSelectedQueueId(null);
    setMembershipsReady(false);
    setHistoryEvents([]);
    setHistoryError("");
    setHistoryLoading(false);
    setHistoryHasMore(false);
    setHistoryNextCursor(null);
    setHistoryLoadingMore(false);
    clearLiveStatus();
  }, [clearLiveStatus]);

  /** Call before persistSession so HomeRedirect waits for a fresh restore. */
  const invalidateMemberships = useCallback(() => {
    setMembershipsReady(false);
    clearLiveStatus();
  }, [clearLiveStatus]);

  const applyMemberships = useCallback((memberships, preferredQueueId) => {
    const list = Array.isArray(memberships) ? memberships : [];
    setActiveMemberships(list);
    if (list.length === 0) {
      setLiveStatus(null);
      setStatusQueueId(null);
      setStatusLastUpdatedAt(null);
      return false;
    }
    const preferred =
      (preferredQueueId && list.find((row) => row.queue?.id === preferredQueueId)) ||
      list[0];
    setLiveStatus(preferred);
    setStatusQueueId(preferred.queue.id);
    setStatusLastUpdatedAt(Date.now());
    setStatusError("");
    return true;
  }, []);

  const restoreActiveMembership = useCallback(async (sessionToken, catalog, guestCred, preferredQueueId) => {
    if (!sessionToken && !guestCred) return false;
    try {
      const data = await fetchActiveMemberships(sessionToken, guestCred);
      return applyMemberships(data.memberships, preferredQueueId);
    } catch {
      // Fallback: probe the catalog one queue at a time (legacy / older API).
      if (!Array.isArray(catalog)) return false;
      const found = [];
      for (const queue of catalog) {
        try {
          const row = await fetchQueueStatus(sessionToken, queue.id, guestCred);
          found.push(row);
        } catch {
          // Not in this queue — try next.
        }
      }
      return applyMemberships(found, preferredQueueId);
    }
  }, [applyMemberships]);

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
        if (restoreStatus || (!sessionToken && !guestCred)) {
          setMembershipsReady(true);
        }
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
        const fromCache = Boolean(data?._fromOfflineCache);
        setLiveStatus((current) =>
          !current || current.queue?.id === queueId ? data : current
        );
        setStatusOffline(fromCache);
        if (!fromCache && statusQueueIdRef.current === queueId) {
          setStatusLastUpdatedAt(Date.now());
        }
        setActiveMemberships((list) => {
          const rest = list.filter((row) => row.queue?.id !== queueId);
          return [...rest, data].sort((a, b) =>
            String(a.queue?.name || "").localeCompare(String(b.queue?.name || ""))
          );
        });
        setStatusError("");
      } catch (err) {
        if (err.status === 404) {
          const rest = activeMembershipsRef.current.filter((row) => row.queue?.id !== queueId);
          setActiveMemberships(rest);
          if (statusQueueIdRef.current === queueId) {
            if (rest.length === 0) {
              clearLiveStatus();
            } else {
              const next = rest[0];
              setLiveStatus(next);
              setStatusQueueId(next.queue.id);
              setStatusLastUpdatedAt(Date.now());
            }
          }
          return;
        }
        setStatusError(err.message || "Could not refresh status");
      } finally {
        if (!silent) setStatusUpdating(false);
      }
    },
    [clearLiveStatus]
  );

  const loadHistory = useCallback(async (sessionToken, guestCred, options = {}) => {
    if (!sessionToken && !guestCred) return;
    const append = Boolean(options.append && options.cursor);
    if (append) setHistoryLoadingMore(true);
    else setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await fetchHistory(sessionToken, guestCred, {
        cursor: options.cursor || undefined,
      });
      const events = Array.isArray(data.events) ? data.events : [];
      setHistoryEvents((prev) => (append ? [...prev, ...events] : events));
      setHistoryHasMore(Boolean(data.hasMore));
      setHistoryNextCursor(data.nextCursor || null);
    } catch (err) {
      if (!append) setHistoryEvents([]);
      setHistoryError(err.message || "Could not load history");
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
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

    const intervalMs = resolveStatusPollMs({
      hidden: tabHidden,
      realtimeConnected,
    });
    if (intervalMs == null) {
      return;
    }

    pollRef.current = setInterval(() => {
      refreshStatus(auth.token, statusQueueId, {
        silent: true,
        guestCred: auth.guestCredential,
      });
    }, intervalMs);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [token, guestCredential, statusQueueId, liveStatus, refreshStatus, joinerAuth, tabHidden, realtimeConnected]);

  const join = useCallback(
    async (queueId, options = {}) => {
      if (!queueId) return false;
      // JWT User/Admin, existing Guest credential, or mint on first Guest join.
      const auth = joinerAuth();
      if (user?.role === "admin" || user?.role === "staff") return false;
      setJoinError("");
      setJoinBusy(true);
      try {
        const data = await joinQueue(auth.token, queueId, auth.guestCredential, options.source);
        if (data.guestCredential) {
          persistGuestCredential(data.guestCredential);
        }
        setLiveStatus(data);
        setStatusQueueId(queueId);
        setActiveMemberships((list) => {
          const rest = list.filter((row) => row.queue?.id !== queueId);
          return [...rest, data];
        });
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

  /** Adopt a status payload from another entry path (e.g. booking check-in). */
  const adoptMembership = useCallback((data) => {
    const queueId = data?.queue?.id;
    if (!queueId) return;
    setLiveStatus(data);
    setStatusQueueId(queueId);
    setActiveMemberships((list) =>
      list.some((row) => row.queue?.id === queueId)
        ? list.map((row) => (row.queue?.id === queueId ? data : row))
        : [...list, data]
    );
    setStatusLastUpdatedAt(Date.now());
    setStatusError("");
  }, []);

  const leave = useCallback(async () => {
    const auth = joinerAuth();
    if ((!auth.token && !auth.guestCredential) || !statusQueueId) return false;
    setLeaveError("");
    setLeaveBusy(true);
    try {
      await leaveQueue(auth.token, statusQueueId, auth.guestCredential);
      const remaining = activeMemberships.filter((row) => row.queue?.id !== statusQueueId);
      // Optional post-leave soft-upgrade reinforce (Guest only; not a banner).
      if (!auth.token && auth.guestCredential && remaining.length === 0) {
        try {
          sessionStorage.setItem(SOFT_UPGRADE_POST_LEAVE_KEY, "1");
        } catch {
          // Private mode / blocked storage — skip reinforce.
        }
      }
      if (remaining.length === 0) {
        clearLiveStatus();
        setSelectedQueueId(null);
    setMembershipsReady(false);
      } else {
        setActiveMemberships(remaining);
        const next = remaining[0];
        setLiveStatus(next);
        setStatusQueueId(next.queue.id);
        setStatusLastUpdatedAt(Date.now());
      }
      return true;
    } catch (err) {
      if (err.status === 404) {
        const remaining = activeMemberships.filter((row) => row.queue?.id !== statusQueueId);
        if (remaining.length === 0) {
          clearLiveStatus();
        } else {
          setActiveMemberships(remaining);
          const next = remaining[0];
          setLiveStatus(next);
          setStatusQueueId(next.queue.id);
          setStatusLastUpdatedAt(Date.now());
        }
        return true;
      }
      setLeaveError(err.message || "Could not leave queue");
      return false;
    } finally {
      setLeaveBusy(false);
    }
  }, [joinerAuth, statusQueueId, activeMemberships, clearLiveStatus]);

  const selectMembership = useCallback(
    async (queueId) => {
      const cached = activeMemberships.find((row) => row.queue?.id === queueId);
      if (cached) {
        setLiveStatus(cached);
        setStatusQueueId(queueId);
        setStatusLastUpdatedAt(Date.now());
      }
      const auth = joinerAuth();
      await refreshStatus(auth.token, queueId, { guestCred: auth.guestCredential });
    },
    [activeMemberships, joinerAuth, refreshStatus]
  );

  return {
    queues,
    queuesLoading,
    queuesError,
    selectedQueueId,
    setSelectedQueueId,
    setJoinError,
    loadQueues,
    liveStatus,
    statusQueueId,
    statusLastUpdatedAt,
    activeMemberships,
    selectMembership,
    joinBusy,
    joinError,
    statusError,
    statusUpdating,
    statusOffline,
    leaveBusy,
    leaveError,
    join,
    adoptMembership,
    leave,
    refreshStatus,
    historyEvents,
    historyLoading,
    historyError,
    historyHasMore,
    historyNextCursor,
    historyLoadingMore,
    loadHistory,
    clearLiveStatus,
    clearStudentSession,
    membershipsReady,
    invalidateMemberships,
    statusQueueIdRef,
    activeMembershipsRef,
  };
}
