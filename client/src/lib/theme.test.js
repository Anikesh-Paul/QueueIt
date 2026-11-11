import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeThemePreference,
  readStoredTheme,
  resolveTheme,
  toggledTheme,
  writeStoredTheme,
} from "./theme.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

test("preference defaults to system and persists explicit choices", () => {
  const s = memoryStorage();
  assert.equal(readStoredTheme(s), "system");
  writeStoredTheme("dark", s);
  assert.equal(s.getItem(THEME_STORAGE_KEY), "dark");
  assert.equal(readStoredTheme(s), "dark");
  writeStoredTheme("neon", s);
  assert.equal(readStoredTheme(s), "system");
  assert.equal(readStoredTheme({ getItem() { throw new Error("blocked"); } }), "system");
  assert.equal(normalizeThemePreference(undefined), "system");
});

test("resolves against the OS setting and toggles to an explicit theme", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(toggledTheme("dark"), "light");
  assert.equal(toggledTheme("light"), "dark");
});

test("applies class, color-scheme and theme-color", () => {
  const classes = new Set();
  let meta = "#1b4332";
  const doc = {
    documentElement: {
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      style: {},
    },
    querySelector: () => ({ setAttribute: (_k, v) => (meta = v) }),
  };
  applyTheme(doc, "dark");
  assert.ok(classes.has("dark"));
  assert.equal(doc.documentElement.style.colorScheme, "dark");
  assert.equal(meta, "#141412");
  applyTheme(doc, "light");
  assert.ok(!classes.has("dark"));
  assert.equal(meta, "#1b4332");
});
