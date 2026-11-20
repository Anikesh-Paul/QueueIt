import { useEffect, useState } from "react";
import { fetchBestTime, fetchBestTimeSummary } from "@/api";

/** Full chart data for one queue and weekday. */
export function useBestTime(queueId, weekday) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!queueId) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    fetchBestTime(queueId, weekday)
      .then((data) => !cancelled && setState({ data, loading: false, error: "" }))
      .catch((err) => !cancelled && setState({ data: null, loading: false, error: err?.message || "error" }));
    return () => {
      cancelled = true;
    };
  }, [queueId, weekday, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

/** Compact data for every queue card, keyed by queue id. Failures just hide the strip. */
export function useBestTimeSummary(enabled = true) {
  const [byQueue, setByQueue] = useState(() => new Map());
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetchBestTimeSummary()
      .then((data) => {
        if (!cancelled) setByQueue(new Map((data.queues || []).map((q) => [q.queueId, q])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return byQueue;
}
