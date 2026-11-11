import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "@/context/app-context";
import {
  NOTIFY_ENABLED_KEY,
  NOTIFY_SOUND_KEY,
  NOTIFY_VIBRATE_KEY,
  decideNotification,
  isNotificationSupported,
  notificationCopy,
} from "@/lib/queue-notifications";

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
  const [permission, setPermission] = useState(() => currentPermission());
  const [enabled, setEnabled] = useState(() => readFlag(NOTIFY_ENABLED_KEY));
  const [sound, setSound] = useState(() => readFlag(NOTIFY_SOUND_KEY));
  const [vibrate, setVibrate] = useState(() => readFlag(NOTIFY_VIBRATE_KEY, true));
  const lastKeyByQueueRef = useRef(new Map());

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
      if (!decision.fire) continue;
      const copy = notificationCopy({
        kind: decision.kind,
        position: row.position,
        queueName: row.queue?.name,
      });
      try {
        new Notification(copy.title, {
          body: copy.body,
          tag: `queueit:${decision.key}`,
        });
      } catch {
        // Some WebViews throw even after permission is granted.
      }
      if (sound) playBeep();
      if (vibrate && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(200);
      }
    }
  }, [enabled, permission, inQueue, liveStatus, activeMemberships, statusQueueId, sound, vibrate]);

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
