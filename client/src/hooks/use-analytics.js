import { useCallback, useState } from "react";
import { fetchAnalytics } from "@/api";

/**
 * Admin analytics slice for one queue (served count, average wait, busy hours).
 */
export function useAnalytics() {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  /**
   * Load ops analytics for one queue.
   * Admin-only route; refreshed on mount and by the Refresh button.
   */
  const loadAnalytics = useCallback(async (sessionToken, queueId, options = {}) => {
    if (!sessionToken || !queueId) return;
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      const data = await fetchAnalytics(sessionToken, queueId, {
        window: options.window,
        from: options.from,
        to: options.to,
      });
      setAnalyticsData(data);
    } catch (err) {
      setAnalyticsData(null);
      setAnalyticsError(err.message || "Could not load analytics");
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const clearAnalytics = useCallback(() => {
    setAnalyticsData(null);
    setAnalyticsError("");
    setAnalyticsLoading(false);
  }, []);

  return {
    analyticsData,
    analyticsLoading,
    analyticsError,
    loadAnalytics,
    clearAnalytics,
  };
}
