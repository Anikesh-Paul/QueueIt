/** Human labels for persisted admin audit actions. */
const ACTION_LABELS = {
  pause: "Paused the queue",
  resume: "Resumed the queue",
  skip: "Skipped a token",
  serve: "Served a token",
  call: "Called a token",
  reset: "Reset the queue",
  "stop-accepting": "Stopped accepting tokens",
  "start-accepting": "Started accepting tokens",
  "service-windows": "Updated service windows",
  "staff-invite": "Invited staff",
  "queue-update": "Updated queue settings",
  rejoin: "Recovered a missed turn",
  "priority-set": "Marked a token as priority",
  "priority-approve": "Approved a priority request",
  "priority-reject": "Declined a priority request",
  "priority-request": "Requested priority",
  "appointment-book": "Booked a time",
  "appointment-checkin": "Checked in a booking",
  "shift-start": "Started a shift",
  "shift-break": "Went on a break",
  "shift-back": "Came back from a break",
  "shift-end": "Ended a shift",
  "shift-open": "Opened a counter",
  "shift-close": "Closed a counter",
  "announcement-post": "Posted a notice",
  "announcement-edit": "Edited a notice",
  "announcement-end": "Ended a notice",
};

export function auditActionLabel(action) {
  if (!action) return "Admin action";
  return ACTION_LABELS[action] || String(action).replace(/-/g, " ");
}

export function auditMetaLine(event) {
  const meta = event?.meta || {};
  const parts = [];
  if (meta.title) parts.push(`“${meta.title}”`);
  if (meta.counter) parts.push(meta.counter);
  if (meta.tokenNumber != null) parts.push(`token ${meta.tokenNumber}`);
  if (meta.cleared != null) parts.push(`${meta.cleared} places cleared`);
  if (meta.email) parts.push(meta.email);
  if (meta.maxWaiting != null) parts.push(`cap ${meta.maxWaiting || "none"}`);
  if (meta.reason) parts.push(meta.reason);
  if (meta.slotStart) {
    const at = new Date(meta.slotStart);
    if (!Number.isNaN(at.getTime())) {
      parts.push(
        `slot ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(at)}`
      );
    }
  }
  return parts.join(" · ");
}
