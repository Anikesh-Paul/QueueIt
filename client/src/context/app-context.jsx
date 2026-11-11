import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fetchMe, API_URL } from "@/api";
import { createRealtimeClient } from "@/lib/realtime";
import { useSession } from "@/hooks/use-session";
import { useStudentQueue } from "@/hooks/use-student-queue";
import { useAdminConsoleState } from "@/hooks/use-admin-console";
import { useAnalytics } from "@/hooks/use-analytics";
import { clearOfflineStatusCache } from "@/lib/register-sw";

export {
  TOKEN_KEY,
  GUEST_CREDENTIAL_KEY,
  GUEST_MODE_KEY,
  SOFT_UPGRADE_POST_LEAVE_KEY,
} from "@/context/session-keys";
/** See `@/lib/poll-interval` for visible / socket / hidden cadences. */

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const {
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
  } = useSession();

  const [tabHidden, setTabHidden] = useState(
    () => typeof document !== "undefined" && document.hidden
  );
  const realtimeRef = useRef(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  useEffect(() => {
    function onVisibility() {
      setTabHidden(document.hidden);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const student = useStudentQueue({
    token,
    user,
    guestCredential,
    joinerAuth,
    persistGuestCredential,
    tabHidden,
    realtimeConnected,
  });
  const {
    setSelectedQueueId,
    loadQueues,
    refreshStatus,
    clearStudentSession,
    activeMembershipsRef,
    statusQueueIdRef,
    activeMemberships,
    statusQueueId,
  } = student;

  const admin = useAdminConsoleState({
    token,
    user,
    tabHidden,
    realtimeConnected,
    setSelectedQueueId,
  });
  const { clearAdminConsole, loadWaitingList, adminQueueId, adminQueueIdRef } = admin;

  const analytics = useAnalytics();
  const { clearAnalytics } = analytics;

  const logout = useCallback(() => {
    persistSession("", null);
    clearStudentSession();
    clearAdminConsole();
    clearAnalytics();
    clearOfflineStatusCache();
  }, [persistSession, clearStudentSession, clearAdminConsole, clearAnalytics]);

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
    // student.loadQueues / logout identities are stable enough for boot; token
    // and guest flags are the intentional triggers (same as the previous monolith).
  }, [token, guestMode, guestCredential, logout, loadQueues, setUser, setBooting]);

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
        const inMemberships = activeMembershipsRef.current.some(
          (row) => row.queue?.id === queueId
        );
        if (queueId === statusQueueIdRef.current || inMemberships) {
          refreshStatus(token, queueId, { silent: true });
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
  }, [token, refreshStatus, loadWaitingList, activeMembershipsRef, statusQueueIdRef, adminQueueIdRef]);

  // Subscribe the socket to the rooms matching the open surfaces.
  useEffect(() => {
    const client = realtimeRef.current;
    if (!client) return;
    const membershipIds = activeMemberships.map((row) => row.queue?.id).filter(Boolean);
    const targets = [
      ...new Set([...membershipIds, statusQueueId, adminQueueId].filter(Boolean)),
    ];
    client.setSubscriptions(targets);
  }, [statusQueueId, adminQueueId, activeMemberships]);

  const wasHiddenRef = useRef(tabHidden);
  useEffect(() => {
    const becameVisible = wasHiddenRef.current && !tabHidden;
    wasHiddenRef.current = tabHidden;
    if (!becameVisible) return;
    const auth = joinerAuth();
    if ((auth.token || auth.guestCredential) && statusQueueId) {
      refreshStatus(auth.token, statusQueueId, {
        silent: true,
        guestCred: auth.guestCredential,
      });
    }
    if (token && adminQueueId && user?.role === "admin") {
      loadWaitingList(token, adminQueueId, { silent: true });
    }
  }, [
    tabHidden,
    statusQueueId,
    adminQueueId,
    token,
    user?.role,
    joinerAuth,
    refreshStatus,
    loadWaitingList,
  ]);

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
    queues: student.queues,
    queuesLoading: student.queuesLoading,
    queuesError: student.queuesError,
    selectedQueueId: student.selectedQueueId,
    setSelectedQueueId: student.setSelectedQueueId,
    setJoinError: student.setJoinError,
    loadQueues: student.loadQueues,
    refreshQueues: student.loadQueues,
    liveStatus: student.liveStatus,
    statusQueueId: student.statusQueueId,
    statusLastUpdatedAt: student.statusLastUpdatedAt,
    inQueue: Boolean(student.liveStatus && student.statusQueueId),
    activeMemberships: student.activeMemberships,
    selectMembership: student.selectMembership,
    joinBusy: student.joinBusy,
    joinError: student.joinError,
    statusError: student.statusError,
    statusUpdating: student.statusUpdating,
    statusOffline: student.statusOffline,
    leaveBusy: student.leaveBusy,
    leaveError: student.leaveError,
    join: student.join,
    leave: student.leave,
    refreshStatus: student.refreshStatus,
    historyEvents: student.historyEvents,
    historyLoading: student.historyLoading,
    historyError: student.historyError,
    historyHasMore: student.historyHasMore,
    historyNextCursor: student.historyNextCursor,
    historyLoadingMore: student.historyLoadingMore,
    loadHistory: student.loadHistory,
    adminQueueId: admin.adminQueueId,
    adminQueueMeta: admin.adminQueueMeta,
    waitingList: admin.waitingList,
    waitingLoading: admin.waitingLoading,
    waitingError: admin.waitingError,
    adminActionBusy: admin.adminActionBusy,
    adminActionError: admin.adminActionError,
    selectedEntryId: admin.selectedEntryId,
    setSelectedEntryId: admin.setSelectedEntryId,
    openAdminConsole: admin.openAdminConsole,
    clearAdminConsole: admin.clearAdminConsole,
    adminCall: admin.adminCall,
    adminServe: admin.adminServe,
    adminSkip: admin.adminSkip,
    adminPause: admin.adminPause,
    adminResume: admin.adminResume,
    adminStopAccepting: admin.adminStopAccepting,
    adminStartAccepting: admin.adminStartAccepting,
    adminExtend: admin.adminExtend,
    adminUpdateServiceWindows: admin.adminUpdateServiceWindows,
    adminReset: admin.adminReset,
    adminWalkIn: admin.adminWalkIn,
    realtimeConnected,
    analyticsData: analytics.analyticsData,
    analyticsLoading: analytics.analyticsLoading,
    analyticsError: analytics.analyticsError,
    loadAnalytics: analytics.loadAnalytics,
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

/** Session/auth fields from the shared app context. */
export function useSessionContext() {
  const {
    token,
    user,
    guestCredential,
    guestMode,
    isGuest,
    booting,
    isAdmin,
    persistSession,
    persistGuestCredential,
    enterGuestMode,
    logout,
  } = useApp();
  return {
    token,
    user,
    guestCredential,
    guestMode,
    isGuest,
    booting,
    isAdmin,
    persistSession,
    persistGuestCredential,
    enterGuestMode,
    logout,
  };
}

/** Student live-status and catalog fields from the shared app context. */
export function useLiveStatus() {
  const {
    queues,
    queuesLoading,
    queuesError,
    selectedQueueId,
    setSelectedQueueId,
    setJoinError,
    loadQueues,
    refreshQueues,
    liveStatus,
    statusQueueId,
    statusLastUpdatedAt,
    inQueue,
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
    leave,
    refreshStatus,
    historyEvents,
    historyLoading,
    historyError,
    historyHasMore,
    historyNextCursor,
    historyLoadingMore,
    loadHistory,
    realtimeConnected,
  } = useApp();
  return {
    queues,
    queuesLoading,
    queuesError,
    selectedQueueId,
    setSelectedQueueId,
    setJoinError,
    loadQueues,
    refreshQueues,
    liveStatus,
    statusQueueId,
    statusLastUpdatedAt,
    inQueue,
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
    leave,
    refreshStatus,
    historyEvents,
    historyLoading,
    historyError,
    historyHasMore,
    historyNextCursor,
    historyLoadingMore,
    loadHistory,
    realtimeConnected,
  };
}

/** Admin console fields from the shared app context. */
export function useAdminConsole() {
  const {
    token,
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
    adminCall,
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
  } = useApp();
  return {
    token,
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
    adminCall,
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
  };
}
