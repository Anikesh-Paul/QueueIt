/**
 * Next unused "Counter N" label for the add-counter placeholder.
 * @param {{ name?: string }[]} counters
 * @returns {string}
 */
export function nextCounterPlaceholder(counters) {
  const taken = new Set(
    (Array.isArray(counters) ? counters : []).map((row) =>
      String(row?.name || "").trim().toLowerCase()
    )
  );
  let n = 1;
  while (taken.has(`counter ${n}`)) n += 1;
  return `Counter ${n}`;
}
