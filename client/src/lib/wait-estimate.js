import { t } from "./i18n.js";


/** Campus (Asia/Kolkata) weekday 0–6 for a timestamp. */
export function campusWeekday(ms = Date.now()) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(ms));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * "8–12 min", or "5 min" when the range collapses. Null when there is no usable range.
 * @param {{ low: number, high: number } | null | undefined} range
 */
export function formatWaitRange(range, locale = "en") {
  if (!range) return null;
  const low = Number(range.low);
  const high = Number(range.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high <= low) return t(locale, "estimate.single", { minutes: Math.max(0, Math.round(high)) });
  return t(locale, "estimate.range", { low: Math.max(0, Math.round(low)), high: Math.round(high) });
}

/** Catalog line for someone joining now. */
export function catalogWaitLabel(waitEstimate, locale = "en") {
  if (!waitEstimate) return null;
  if (Number(waitEstimate.high) <= 1 || waitEstimate.source === "empty") return t(locale, "estimate.catalogNone");
  const range = formatWaitRange(waitEstimate, locale);
  return range ? t(locale, "estimate.catalog", { range }) : null;
}

/** One plain sentence saying what the estimate rests on. */
export function estimateBasisLine(basis, { locale = "en", nowMs = Date.now() } = {}) {
  if (!basis?.source) return null;
  const day = campusWeekday(nowMs);
  const weekday = day >= 0 ? t(locale, `days.long.${day}`) : "";
  const vars = { weeks: basis.weeks || 4, weekday };
  switch (basis.source) {
    case "blend":
      return t(locale, "estimate.basisBlend", vars);
    case "history":
      return t(locale, "estimate.basisHistory", vars);
    case "recent":
      return t(locale, "estimate.basisRecent");
    default:
      return t(locale, "estimate.basisConfigured");
  }
}

export function confidenceLabel(confidence, locale = "en") {
  if (!["low", "medium", "high"].includes(confidence)) return null;
  return t(locale, `estimate.confidence.${confidence}`);
}

/** Staff readout: "Today 2 min · Typical 5 min" (either side may be missing). */
export function paceReadout(basis) {
  if (!basis) return null;
  const parts = [];
  if (Number.isFinite(basis.recentPace)) parts.push(`Today ${basis.recentPace} min`);
  if (Number.isFinite(basis.typicalPace)) parts.push(`Typical ${basis.typicalPace} min`);
  if (!parts.length) return "Using the configured average";
  return parts.join(" · ");
}
