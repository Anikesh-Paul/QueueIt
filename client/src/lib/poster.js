/**
 * Copy helpers for the printable queue poster.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "13:05" → "1:05 PM" (invalid input is returned unchanged). */
export function formatClock(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!match) return String(hhmm || "");
  const h = Number(match[1]);
  const m = match[2];
  const period = h < 12 || h === 24 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/** [1,2,3,4,5] → "Mon–Fri"; null/empty → "Daily"; non-contiguous → "Mon, Wed, Fri". */
export function formatDays(days) {
  if (!Array.isArray(days) || days.length === 0 || days.length === 7) return "Daily";
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return "Sat–Sun";
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) return `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

/**
 * Service windows → poster lines grouped by day set, e.g.
 * ["Daily · 11:30 AM – 2:30 PM, 7:00 PM – 9:00 PM"]. Empty → [].
 */
export function formatServiceHours(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return [];
  const groups = new Map();
  for (const w of windows) {
    if (!w?.start || !w?.end) continue;
    const label = formatDays(w.days);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(`${formatClock(w.start)} – ${formatClock(w.end)}`);
  }
  return [...groups.entries()].map(([label, ranges]) => `${label} · ${ranges.join(", ")}`);
}

/** Short display form of a join URL for print (no protocol, no query). */
export function displayLink(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return String(url);
  }
}
