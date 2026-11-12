/** Pure helpers for the staff shift view. */

export const STATE_LABEL = { open: "Open", break: "On break", closed: "Closed" };

/** Which buttons a console user gets on one counter row. */
export function counterActions(counter, { meId, onShift } = {}) {
  const mine = Boolean(meId && counter?.staffedBy?.id === meId);
  const other = Boolean(counter?.staffedBy && !mine);
  if (mine) {
    return counter.state === "break" ? ["back", "end"] : ["break", "end"];
  }
  if (other) return [];
  const actions = [];
  if (!onShift) actions.push("start");
  actions.push(counter?.state === "closed" ? "open" : "close");
  return actions;
}

export const ACTION_LABEL = {
  start: "Start shift here",
  break: "Take a break",
  back: "I'm back",
  end: "End shift",
  open: "Open counter",
  close: "Close counter",
};

/** "2 of 3 open" style summary. */
export function staffingSummary(queue) {
  const open = queue?.countersOpen ?? 0;
  const total = queue?.countersTotal ?? 0;
  if (!total) return "No counters";
  if (open === total) return total === 1 ? "Counter open" : `All ${total} counters open`;
  if (open === 0) return total === 1 ? "Counter closed" : `All ${total} counters closed`;
  return `${open} of ${total} counters open`;
}

/** Minutes each at the current staffing (matches the server's ETA factor). */
export function effectivePace(queue) {
  if (Number.isFinite(queue?.pace) && queue.pace > 0) return queue.pace;
  const pace = Number(queue?.averageServiceTime);
  const total = queue?.countersTotal || 1;
  const open = Math.max(1, queue?.countersOpen || 0);
  if (!Number.isFinite(pace) || pace <= 0) return null;
  return Math.round(((pace * total) / open) * 10) / 10;
}
