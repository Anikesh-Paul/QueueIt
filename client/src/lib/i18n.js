import en from "../locales/en.js";
import hi from "../locales/hi.js";
import bn from "../locales/bn.js";

/**
 * QueueIt copy in English, Hindi and Bengali. English is the source and the
 * fallback; every locale must carry every English key (i18n.test.js fails on a
 * missing or extra key, or a placeholder that doesn't match).
 */
export const DEFAULT_LOCALE = "en";
export const LOCALES = ["en", "hi", "bn"];
export const LOCALE_STORAGE_KEY = "queueit_locale";

/** Switcher labels: each language names itself. */
export const LOCALE_OPTIONS = [
  { id: "en", short: "EN", name: "English" },
  { id: "hi", short: "हिं", name: "हिन्दी" },
  { id: "bn", short: "বাং", name: "বাংলা" },
];

export const MESSAGES = { en, hi, bn };

export function normalizeLocale(value) {
  const tag = String(value || "").trim().toLowerCase();
  for (const loc of LOCALES) {
    if (tag === loc || tag.startsWith(`${loc}-`)) return loc;
  }
  return null;
}

export function detectBrowserLocale(languages = []) {
  const list = Array.isArray(languages) ? languages : [];
  for (const lang of list) {
    const loc = normalizeLocale(lang);
    if (loc) return loc;
  }
  return DEFAULT_LOCALE;
}

export function readStoredLocale(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return null;
    return normalizeLocale(store.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale, storage) {
  const loc = normalizeLocale(locale) || DEFAULT_LOCALE;
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return loc;
    store.setItem(LOCALE_STORAGE_KEY, loc);
  } catch {
    // Private mode / blocked storage — keep the in-memory preference only.
  }
  return loc;
}

/**
 * Stored preference wins. Otherwise the browser/OS language if it is
 * English, Hindi or Bengali. Anything else falls back to English.
 */
export function resolveInitialLocale({ storage, languages } = {}) {
  return (
    readStoredLocale(storage) ||
    detectBrowserLocale(
      languages || (typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : [])
    ) ||
    DEFAULT_LOCALE
  );
}

export function interpolate(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? `{${key}}` : String(vars[key])
  );
}

export function t(locale, key, vars = {}) {
  const loc = normalizeLocale(locale) || DEFAULT_LOCALE;
  const table = MESSAGES[loc] || MESSAGES.en;
  const str = table[key] ?? MESSAGES.en[key] ?? key;
  return interpolate(str, vars);
}

/**
 * Intl locale for dates and numbers: Indian conventions (lakh grouping,
 * 12-hour clock) in every language. Digits stay Latin (0–9) in Bengali too, so
 * token numbers and times read the same as on the counter display and poster.
 */
export function intlLocale(locale) {
  const loc = normalizeLocale(locale) || DEFAULT_LOCALE;
  if (loc === "hi") return "hi-IN";
  if (loc === "bn") return "bn-IN-u-nu-latn";
  return "en-IN";
}

/** <html lang> value for a locale. */
export function htmlLang(locale) {
  return normalizeLocale(locale) || DEFAULT_LOCALE;
}

/** Format a number with Indian grouping (1,00,000) in the active language. */
export function formatNumber(locale, value, options = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return new Intl.NumberFormat(intlLocale(locale), options).format(n);
}
