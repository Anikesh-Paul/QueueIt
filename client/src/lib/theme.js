/**
 * Light / dark theme preference. "system" follows prefers-color-scheme.
 * The same logic runs inline in index.html before first paint (no flash).
 */
export const THEME_STORAGE_KEY = "queueit_theme";
export const THEME_PREFERENCES = ["light", "dark", "system"];
export const THEME_COLORS = { light: "#1b4332", dark: "#141412" };

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

export function readStoredTheme(storage) {
  try {
    return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeStoredTheme(preference, storage) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, normalizeThemePreference(preference));
  } catch {
    // Private mode / storage full: the choice just won't persist.
  }
}

/** Preference + OS setting → "light" | "dark". */
export function resolveTheme(preference, prefersDark) {
  const pref = normalizeThemePreference(preference);
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

/** The explicit preference a toggle press should save. */
export function toggledTheme(resolved) {
  return resolved === "dark" ? "light" : "dark";
}

/** Apply a resolved theme to a document (class, color-scheme, theme-color meta). */
export function applyTheme(doc, resolved) {
  if (!doc?.documentElement) return;
  const root = doc.documentElement;
  const dark = resolved === "dark";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = doc.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
}
