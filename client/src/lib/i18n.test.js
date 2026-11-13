import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_OPTIONS,
  MESSAGES,
  detectBrowserLocale,
  formatNumber,
  htmlLang,
  intlLocale,
  normalizeLocale,
  resolveInitialLocale,
  t,
  writeStoredLocale,
} from "./i18n.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

/** Every source file that can render copy (tests and the locale files themselves excluded). */
function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : sourceFiles(full);
    return /\.(jsx?|mjs)$/.test(entry.name) && !entry.name.endsWith(".test.js") ? [full] : [];
  });
}

describe("i18n catalog", () => {
  const enKeys = Object.keys(MESSAGES.en).sort();

  it("ships English, Hindi and Bengali, each named in its own script", () => {
    assert.deepEqual(LOCALES, ["en", "hi", "bn"]);
    assert.deepEqual(LOCALE_OPTIONS.map((o) => o.id), LOCALES);
    assert.deepEqual(LOCALE_OPTIONS.map((o) => o.name), ["English", "हिन्दी", "বাংলা"]);
    assert.ok(enKeys.length > 400, `only ${enKeys.length} English keys`);
  });

  for (const locale of LOCALES) {
    it(`${locale} has every English key and nothing extra`, () => {
      const keys = Object.keys(MESSAGES[locale]).sort();
      const missing = enKeys.filter((k) => !(k in MESSAGES[locale]));
      const extra = keys.filter((k) => !(k in MESSAGES.en));
      assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(", ")}`);
      assert.deepEqual(extra, [], `${locale} has keys English doesn't: ${extra.join(", ")}`);
    });

    it(`${locale} keeps every {placeholder} and has no empty strings`, () => {
      for (const key of enKeys) {
        const value = MESSAGES[locale][key];
        assert.equal(typeof value, "string", `${locale} ${key} is not a string`);
        assert.ok(value.trim().length > 0, `${locale} ${key} is empty`);
        assert.deepEqual(placeholders(value), placeholders(MESSAGES.en[key]), `${locale} ${key} placeholders differ`);
      }
    });
  }

  it("Hindi and Bengali copy is actually in Devanagari and Bengali script", () => {
    const share = (locale, re) => {
      const values = Object.values(MESSAGES[locale]);
      return values.filter((v) => re.test(v)).length / values.length;
    };
    assert.ok(share("hi", /[\u0900-\u097F]/) > 0.9);
    assert.ok(share("bn", /[\u0980-\u09FF]/) > 0.9);
  });

  it("every literal key the app passes to t() exists in English", () => {
    const used = new Set();
    for (const file of sourceFiles()) {
      const code = fs.readFileSync(file, "utf8");
      for (const m of code.matchAll(/\bt\(\s*(?:[A-Za-z_$][\w$.]*\s*,\s*)?["']([a-zA-Z][\w-]*(?:\.[\w-]+)+|skipToContent)["']/g)) {
        used.add(m[1]);
      }
    }
    assert.ok(used.size > 300, `only found ${used.size} keys — is the scan broken?`);
    const missing = [...used].filter((k) => !(k in MESSAGES.en)).sort();
    assert.deepEqual(missing, [], `keys used in src but missing from en.js: ${missing.join(", ")}`);
  });
});

describe("choosing a language", () => {
  it("defaults to English and detects Hindi or Bengali from the browser", () => {
    assert.equal(DEFAULT_LOCALE, "en");
    assert.equal(detectBrowserLocale(["en-US", "hi"]), "en");
    assert.equal(detectBrowserLocale(["hi-IN", "en"]), "hi");
    assert.equal(detectBrowserLocale(["bn-IN", "en"]), "bn");
    assert.equal(detectBrowserLocale(["bn-BD"]), "bn");
    assert.equal(detectBrowserLocale(["fr-FR", "bn"]), "bn");
    assert.equal(detectBrowserLocale(["fr-FR"]), "en");
    assert.equal(normalizeLocale("BN"), "bn");
    assert.equal(normalizeLocale("bnx"), null);
  });

  it("remembers the choice on this device over the browser language", () => {
    const mem = memoryStorage();
    assert.equal(resolveInitialLocale({ storage: mem, languages: ["bn-IN"] }), "bn");
    writeStoredLocale("hi", mem);
    assert.equal(resolveInitialLocale({ storage: mem, languages: ["bn-IN"] }), "hi");
    writeStoredLocale("nonsense", mem);
    assert.equal(resolveInitialLocale({ storage: mem, languages: ["bn-IN"] }), "en");
  });

  it("sets <html lang> to the language code", () => {
    assert.equal(htmlLang("bn"), "bn");
    assert.equal(htmlLang("hi"), "hi");
    assert.equal(htmlLang("xx"), "en");
  });
});

describe("t()", () => {
  it("returns copy in each language and falls back to English, then the key", () => {
    assert.equal(t("en", "queues.title"), "Queues");
    assert.equal(t("hi", "queues.title"), "कतारें");
    assert.equal(t("bn", "queues.title"), "লাইন");
    assert.equal(t("hi", "queue.join", { name: "Cafeteria" }), "Cafeteria में शामिल हों");
    assert.equal(t("bn", "queue.join", { name: "Cafeteria" }), "Cafeteria-এর লাইনে দাঁড়ান");
    assert.equal(t("bn", "missing.key.not-translated"), "missing.key.not-translated");
    assert.equal(t("xx", "auth.motif"), "Hold your place in the mess line on your phone.");
  });
});

describe("Indian number and time formatting", () => {
  it("groups numbers in lakhs and keeps Latin digits in every language", () => {
    assert.equal(formatNumber("en", 1234567), "12,34,567");
    assert.equal(formatNumber("hi", 1234567), "12,34,567");
    assert.equal(formatNumber("bn", 1234567), "12,34,567");
    assert.equal(formatNumber("bn", 42), "42");
    assert.equal(formatNumber("en", "n/a"), "n/a");
  });

  it("uses Indian locales for dates and times", () => {
    assert.equal(intlLocale("en"), "en-IN");
    assert.equal(intlLocale("hi"), "hi-IN");
    assert.equal(intlLocale("bn"), "bn-IN-u-nu-latn");
    const at = new Date("2026-11-14T13:05:00Z");
    const bn = new Intl.DateTimeFormat(intlLocale("bn"), { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(at);
    assert.match(bn, /6:35/);
  });
});
