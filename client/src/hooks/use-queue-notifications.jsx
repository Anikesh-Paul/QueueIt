import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { fetchQueues } from "@/api";
import { STATUS_POLL_VISIBLE_MS } from "@/lib/poll-interval";
import {
  NOTIFY_ENABLED_KEY,
  NOTIFY_SOUND_KEY,
  NOTIFY_VIBRATE_KEY,
  decideNotification,
  isNotificationSupported,
  notificationCopy,
} from "@/lib/queue-notifications";
import {
  cancelOpenWatch as removeOpenWatch,
  decideOpenNotification,
  isWatchingOpen as hasOpenWatch,
  openNotificationCopy,
  readOpenWatches,
  subscribeOpenWatch as addOpenWatch,
  writeOpenWatches,
} from "@/lib/open-queue-watch";
import { decideLeaveNotification, liveLeave } from "@/lib/leave-alert";
import { t as translate } from "@/lib/i18n";

const NotifyContext = createContext(null);

function readFlag(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Private mode / blocked storage — keep the in-memory preference only.
  }
}

function currentPermission() {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Show a system notification. Prefer the service worker registration so it
 * works on Android Chrome (where `new Notification` throws) and while the tab
 * is in the background; fall back to the page Notification API.
 */
function showSystemNotification(title, options) {
  const fallback = () => {
    try {
      new Notification(title, options);
    } catch {
      // Some WebViews throw even after permission is granted; the banner still shows.
    }
  };
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.getRegistration) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => (reg?.showNotification ? reg.showNotification(title, options) : fallback()))
        .catch(fallback);
      return;
    }
  } catch {
    // fall through
  }
  fallback();
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.07;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close?.();
    }, 140);
  } catch {
    // Autoplay or AudioContext unavailable — skip sound.
  }
}

function useQueueNotificationState() {
  const { liveStatus, statusQueueId, inQueue, activeMemberships } = useApp();
  const { locale } = useI18n();
  const [permission, setPermission] = useState(() => currentPermission());
  const [enabled, setEnabled] = useState(() => readFlag(NOTIFY_ENABLED_KEY));
  const [sound, setSound] = useState(() => readFlag(NOTIFY_SOUND_KEY));
  const [vibrate, setVibrate] = useState(() => readFlag(NOTIFY_VIBRATE_KEY, true));
  const lastKeyByQueueRef = useRef(new Map());
  const lastLeaveKeyRef = useRef(new Map());
  const [openWatches, setOpenWatches] = useState(() => readOpenWatches());
  const previousAcceptingRef = useRef(new Map());

  const supported = permission !== "unsupported";

  const refreshPermission = useCallback(() => {
    setPermission(currentPermission());
  }, []);

  const requestEnable = useCallback(async () => {
    if (!isNotificationSupported()) {
      setPermission("unsupported");
      return "unsupported";
    }
    let result = Notification.permission;
    if (result === "default") {
      result = await Notification.requestPermission();
    }
    setPermission(result);
    if (result === "granted") {
      writeFlag(NOTIFY_ENABLED_KEY, true);
      setEnabled(true);
    }
    return result;
  }, []);

  const setNotificationsOn = useCallback((on) => {
    writeFlag(NOTIFY_ENABLED_KEY, on);
    setEnabled(Boolean(on));
  }, []);

  const setSoundOn = useCallback((on) => {
    writeFlag(NOTIFY_SOUND_KEY, on);
    setSound(Boolean(on));
  }, []);

  const setVibrateOn = useCallback((on) => {
    writeFlag(NOTIFY_VIBRATE_KEY, on);
    setVibrate(Boolean(on));
  }, []);

  const persistOpenWatches = useCallback((next) => {
    const saved = writeOpenWatches(next);
    setOpenWatches(saved);
    return saved;
  }, []);

  const isWatchingOpen = useCallback(
    (queueId) => hasOpenWatch(openWatches, queueId),
    [openWatches]
  );

  const cancelOpenWatch = useCallback(
    (queueId) => {
      persistOpenWatches(removeOpenWatch(openWatches, queueId));
      previousAcceptingRef.current.delete(queueId);
    },
    [openWatches, persistOpenWatches]
  );

  const requestOpenWatch = useCallback(
    async (queueId) => {
      if (!queueId || !isNotificationSupported()) return "unsupported";
      let result = Notification.permission;
      if (result === "default") {
        result = await Notification.requestPermission();
      }
      setPermission(result);
      if (result !== "granted") {
        // Quietly no-op when permission is denied (or still default).
        return result;
      }
      writeFlag(NOTIFY_ENABLED_KEY, true);
      setEnabled(true);
      previousAcceptingRef.current.set(queueId, false);
      persistOpenWatches(addOpenWatch(openWatches, queueId));
      return result;
    },
    [openWatches, persistOpenWatches]
  );

  useEffect(() => {
    if (permission !== "granted" || openWatches.length === 0) return undefined;

    let cancelled = false;
    let timer = null;

    const fireOpen = (queue) => {
      const copy = openNotificationCopy({ queueName: queue?.name, locale });
      try {
        new Notification(copy.title, {
          body: copy.body,
          tag: `queueit:open:${queue?.id || ""}`,
        });
      } catch {
        // Some WebViews throw even after permission is granted.
      }
      if (sound) playBeep();
      if (vibrate && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(200);
      }
    };

    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      let catalog = [];
      try {
        const payload = await fetchQueues();
        catalog = Array.isArray(payload) ? payload : payload?.queues || [];
      } catch {
        return;
      }
      if (cancelled) return;

      const current = openWatches;
      let next = current;
      const toFire = [];
      for (const queueId of current) {
        const queue = catalog.find((row) => row.id === queueId);
        if (!queue) continue;
        const decision = decideOpenNotification({
          watching: true,
          previousAccepting: previousAcceptingRef.current.has(queueId)
            ? previousAcceptingRef.current.get(queueId)
            : null,
          acceptingTokens: queue.acceptingTokens !== false,
        });
        previousAcceptingRef.current.set(queueId, decision.previousAccepting);
        if (decision.fire) toFire.push(queue);
        if (!decision.watching) {
          next = removeOpenWatch(next, queueId);
          previousAcceptingRef.current.delete(queueId);
        }
      }
      if (next !== current) persistOpenWatches(next);
      for (const queue of toFire) fireOpen(queue);
    };

    const start = () => {
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = null;
        return;
      }
      tick();
      timer = setInterval(tick, STATUS_POLL_VISIBLE_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [permission, openWatches, persistOpenWatches, sound, vibrate, locale]);

  useEffect(() => {
    if (!enabled || permission !== "granted") return;

    const snapshots = [];
    if (Array.isArray(activeMemberships) && activeMemberships.length > 0) {
      snapshots.push(...activeMemberships);
    } else if (inQueue && liveStatus) {
      snapshots.push(liveStatus);
    }

    for (const row of snapshots) {
      const queueId = row.queue?.id || statusQueueId;
      const decision = decideNotification({
        paused: row.queue?.status === "paused",
        position: row.position,
        tokenNumber: row.tokenNumber,
        nowServing: row.nowServing,
        status: row.status,
        queueId,
        lastKey: lastKeyByQueueRef.current.get(queueId) ?? null,
      });
      if (decision.lastKey) {
        lastKeyByQueueRef.current.set(queueId, decision.lastKey);
      } else {
        lastKeyByQueueRef.current.delete(queueId);
      }
      const leaveDecision = decideLeaveNotification({
        leave: row.queue?.status === "paused" ? null : liveLeave(row.leave),
        position: row.position,
        queueId,
        tokenNumber: row.tokenNumber,
        lastKey: lastLeaveKeyRef.current.get(queueId) ?? null,
      });
      if (leaveDecision.lastKey) lastLeaveKeyRef.current.set(queueId, leaveDecision.lastKey);
      if (leaveDecision.fire) {
        const queue = row.queue?.name || translate(locale, "common.queue");
        showSystemNotification(translate(locale, "leave.notifyTitle", { queue }), {
          body: translate(locale, "leave.notifyBody", { eta: Math.max(0, Math.round(row.etaMinutes ?? 0)) }),
          tag: `queueit:${leaveDecision.key}`,
        });
        if (sound) playBeep();
        if (vibrate && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate([120, 80, 120]);
        }
      }
      if (!decision.fire) continue;
      const copy = notificationCopy({
        kind: decision.kind,
        position: row.position,
        queueName: row.queue?.name,
        locale,
      });
      showSystemNotification(copy.title, {
        body: copy.body,
        tag: `queueit:${decision.key}`,
      });
      if (sound) playBeep();
      if (vibrate && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(200);
      }
    }
  }, [enabled, permission, inQueue, liveStatus, activeMemberships, statusQueueId, sound, vibrate, locale]);

  return {
    supported,
    permission,
    enabled: enabled && permission === "granted",
    wantsNotifications: enabled,
    sound,
    vibrate,
    requestEnable,
    setNotificationsOn,
    setSoundOn,
    setVibrateOn,
    refreshPermission,
    openWatches,
    isWatchingOpen,
    requestOpenWatch,
    cancelOpenWatch,
  };
}

export function QueueNotifyProvider({ children }) {
  const value = useQueueNotificationState();
  return <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>;
}

export function useQueueNotify() {
  const ctx = useContext(NotifyContext);
  if (!ctx) {
    throw new Error("useQueueNotify must be used within a QueueNotifyProvider");
  }
  return ctx;
}
