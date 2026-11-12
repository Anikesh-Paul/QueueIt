import { useCallback, useEffect, useState } from "react";
import { fetchNotices } from "@/api";

const POLL_MS = 60_000;

/** Live notices (optionally for one queue), refreshed every minute and on focus. */
export function useNotices(queueId, { enabled = true } = {}) {
  const [notices, setNotices] = useState([]);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchNotices(queueId);
      setNotices(Array.isArray(data?.announcements) ? data.announcements : []);
    } catch {
      // Notices are a nice-to-have; keep what we had.
    }
  }, [queueId, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const id = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, enabled]);

  return notices;
}
