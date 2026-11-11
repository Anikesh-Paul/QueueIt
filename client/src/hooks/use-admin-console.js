import { useCallback, useEffect, useRef, useState } from "react";
import {
  extendAcceptingSession,
  fetchWaitingList,
  pauseQueue,
  resetQueue,
  resumeQueue,
  callQueue,
  serveQueue,
  skipQueue,
  startAcceptingTokens,
  stopAcceptingTokens,
  updateServiceWindows,
  walkInQueue,
  addQueueCounter,
  renameQueueCounter,
  removeQueueCounter,
} from "@/api";
import { resolveStatusPollMs } from "@/lib/poll-interval";

/**
 * Admin console surface: waiting list, operate actions, windows, walk-in.
 */
export function useAdminConsoleState({
  token,
  user,
  tabHidden,
  realtimeConnected,
  setSelectedQueueId,
}) {
  const [adminQueueId, setAdminQueueId] = useState(null);
  const [adminQueueMeta, setAdminQueueMeta] = useState(null);
  const [waitingList, setWaitingList] = useState([]);
  const [waitingLoading, setWaitingLoading] = useState(false);
  const [waitingError, setWaitingError] = useState("");
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [adminActionError, setAdminActionError] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState(null);

  const adminPollRef = useRef(null);
  const adminQueueIdRef = useRef(null);

  useEffect(() => {
    adminQueueIdRef.current = adminQueueId;
  }, [adminQueueId]);

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

  // Poll admin waiting list while the console is open.
  useEffect(() => {
    if (!token || !adminQueueId || user?.role !== "admin") {
      if (adminPollRef.current) {
        clearInterval(adminPollRef.current);
        adminPollRef.current = null;
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

    adminPollRef.current = setInterval(() => {
      loadWaitingList(token, adminQueueId, { silent: true });
    }, intervalMs);

    return () => {
      if (adminPollRef.current) {
        clearInterval(adminPollRef.current);
        adminPollRef.current = null;
      }
    };
  }, [token, adminQueueId, user?.role, loadWaitingList, tabHidden, realtimeConnected]);

  const openAdminConsole = useCallback(
    async (queueId) => {
      if (!token || !queueId) return;
      setSelectedQueueId(queueId);
      setSelectedEntryId(null);
      setAdminActionError("");
      await loadWaitingList(token, queueId);
    },
    [token, loadWaitingList, setSelectedQueueId]
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

  const adminCall = useCallback(
    (entryId, counterId) =>
      runAdminAction(
        () => callQueue(token, adminQueueId, entryId || undefined, counterId || undefined),
        "Call failed",
        { clearSelection: true }
      ),
    [token, adminQueueId, runAdminAction]
  );

  const adminServe = useCallback(
    (entryId, counterId) =>
      runAdminAction(
        () => serveQueue(token, adminQueueId, entryId || undefined, counterId || undefined),
        "Serve failed",
        { clearSelection: true }
      ),
    [token, adminQueueId, runAdminAction]
  );

  const adminSkip = useCallback(
    (entryId, counterId) =>
      runAdminAction(
        () => skipQueue(token, adminQueueId, entryId || undefined, counterId || undefined),
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
   * Replace service windows and optional exception dates (campus IST).
   * @param {{ start: string, end: string, days?: number[] }[]} serviceWindows
   * @param {{ date: string, closed?: boolean, windows?: { start: string, end: string }[] }[]} [serviceExceptions]
   */
  const adminUpdateServiceWindows = useCallback(
    (serviceWindows, serviceExceptions) =>
      runAdminAction(
        () => updateServiceWindows(token, adminQueueId, serviceWindows, serviceExceptions),
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

  const adminAddCounter = useCallback(
    (name) =>
      runAdminAction(
        () => addQueueCounter(token, adminQueueId, { name }),
        "Could not add counter"
      ),
    [token, adminQueueId, runAdminAction]
  );

  const adminRenameCounter = useCallback(
    (counterId, name) =>
      runAdminAction(
        () => renameQueueCounter(token, adminQueueId, counterId, { name }),
        "Could not rename counter"
      ),
    [token, adminQueueId, runAdminAction]
  );

  const adminRemoveCounter = useCallback(
    (counterId) =>
      runAdminAction(
        () => removeQueueCounter(token, adminQueueId, counterId),
        "Could not remove counter"
      ),
    [token, adminQueueId, runAdminAction]
  );

  return {
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
    loadWaitingList,
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
    adminAddCounter,
    adminRenameCounter,
    adminRemoveCounter,
    adminQueueIdRef,
  };
}
