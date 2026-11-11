import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  resolveInitialLocale,
  t as translate,
  writeStoredLocale,
} from "@/lib/i18n";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => resolveInitialLocale());

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale === "hi" ? "hi" : "en";
  }, [locale]);

  const setLocale = useCallback((next) => {
    const loc = normalizeLocale(next) || DEFAULT_LOCALE;
    writeStoredLocale(loc);
    setLocaleState(loc);
  }, []);

  const t = useCallback((key, vars) => translate(locale, key, vars), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const locale = DEFAULT_LOCALE;
    return {
      locale,
      setLocale: () => {},
      t: (key, vars) => translate(locale, key, vars),
    };
  }
  return ctx;
}
