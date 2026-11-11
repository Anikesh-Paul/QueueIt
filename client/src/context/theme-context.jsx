import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyTheme, readStoredTheme, resolveTheme, toggledTheme, writeStoredTheme } from "@/lib/theme";

const ThemeContext = createContext(null);

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

/** Theme preference (light / dark / system) with persistence and OS tracking. */
export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(() =>
    typeof window === "undefined" ? "system" : readStoredTheme(window.localStorage)
  );
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const onChange = (event) => setPrefersDark(event.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const resolved = resolveTheme(preference, prefersDark);

  useEffect(() => {
    applyTheme(document, resolved);
  }, [resolved]);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    writeStoredTheme(next, window.localStorage);
  }, []);

  const toggle = useCallback(() => setPreference(toggledTheme(resolved)), [resolved, setPreference]);

  const value = useMemo(() => ({ preference, resolved, setPreference, toggle }), [preference, resolved, setPreference, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
