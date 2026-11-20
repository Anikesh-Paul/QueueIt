import { useCallback, useEffect, useState } from "react";
import { fetchFavorites, setFavorite } from "@/api";

/**
 * Starred queues for a signed-in student. Guests and staff get an empty,
 * read-only list. Toggles are optimistic and roll back if the server says no.
 */
export function useFavorites(token, enabled) {
  const [favorites, setFavorites] = useState([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!token || !enabled) {
      setFavorites([]);
      return undefined;
    }
    let cancelled = false;
    fetchFavorites(token)
      .then((data) => {
        if (!cancelled) setFavorites(Array.isArray(data.favorites) ? data.favorites : []);
      })
      .catch(() => {
        if (!cancelled) setFavorites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, enabled]);

  const toggle = useCallback(
    async (queueId) => {
      if (!token || !enabled || pending) return;
      const id = String(queueId);
      const starred = !favorites.includes(id);
      const before = favorites;
      setError("");
      setPending(id);
      setFavorites(starred ? [...favorites, id] : favorites.filter((f) => f !== id));
      try {
        const data = await setFavorite(token, id, starred);
        setFavorites(Array.isArray(data.favorites) ? data.favorites : before);
      } catch (err) {
        setFavorites(before);
        setError(err?.status === 409 ? "favorites.limit" : "favorites.failed");
      } finally {
        setPending(null);
      }
    },
    [token, enabled, favorites, pending]
  );

  return { favorites, toggle, pending, error, clearError: () => setError("") };
}
