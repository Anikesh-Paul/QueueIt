import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  resolveInitialLocale,
  t,
  writeStoredLocale,
} from "./i18n.js";

describe("student i18n", () => {
  it("defaults to English and can detect Hindi from the browser language", () => {
    assert.equal(DEFAULT_LOCALE, "en");
    assert.equal(detectBrowserLocale(["en-US", "hi"]), "en");
    assert.equal(detectBrowserLocale(["hi-IN", "en"]), "hi");
    assert.equal(detectBrowserLocale(["fr-FR"]), "en");
  });

  it("lets a stored preference win over the browser language", () => {
    const storage = new Map();
    const mem = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    };
    assert.equal(resolveInitialLocale({ storage: mem, languages: ["hi-IN"] }), "hi");
    writeStoredLocale("en", mem);
    assert.equal(resolveInitialLocale({ storage: mem, languages: ["hi-IN"] }), "en");
  });

  it("returns English or Hindi student copy, falling back to English", () => {
    assert.equal(t("en", "queues.title"), "Queues");
    assert.equal(t("hi", "queues.title"), "कतारें");
    assert.equal(t("hi", "queue.join", { name: "Cafeteria" }), "Cafeteria में शामिल हों");
    assert.equal(t("hi", "missing.key.not-translated"), "missing.key.not-translated");
    assert.equal(t("en", "auth.motif"), "Hold your place in the mess line on your phone.");
  });
});
