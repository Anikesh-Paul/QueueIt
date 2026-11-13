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
  "no-show": "Marked a no-show (grace period ran out)",
  "no-show-flag": "Flagged a frequent no-show",
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
  "walk-in": "Added a walk-in",
  "staff-access": "Changed staff access",
  "venue-create": "Added a venue",
  "venue-rename": "Renamed a venue",
  "venue-move": "Moved a venue to another organization",
  "org-create": "Added an organization",
  "org-rename": "Renamed an organization",
  "queue-create": "Added a queue",
  "queue-archive": "Archived a queue",
  "queue-restore": "Restored a queue",
  "counter-add": "Added a counter",
  "counter-rename": "Renamed a counter",
  "counter-remove": "Removed a counter",
  "2fa-enabled": "Turned on two-step sign-in",
  "2fa-disabled": "Turned off two-step sign-in",
  "2fa-backup-codes": "Made new backup codes",
  "sign-out-all": "Signed out of all devices",
  "login-lockout": "Sign-in locked after failed attempts",
};

/** Filter groups; must match AUDIT_CATEGORIES on the server. */
export const AUDIT_CATEGORIES = [
  { id: "operations", label: "Queue operations" },
  { id: "settings", label: "Settings and catalog" },
  { id: "staff", label: "Staff and shifts" },
  { id: "notices", label: "Notices" },
  { id: "bookings", label: "Bookings and priority" },
  { id: "security", label: "Sign-in and security" },
];

const FIELD_LABELS = {
  name: "name",
  averageServiceTime: "service time",
  serviceWindows: "hours",
  maxWaiting: "cap",
  guestJoin: "guest joining",
  appointmentsEnabled: "bookings",
  slotMinutes: "slot length",
  slotCapacity: "slot size",
  slotGraceMinutes: "slot grace",
  noShowMinutes: "no-show window",
  noShowMode: "no-show mode",
  noShowAutoCall: "auto-call after no-show",
  priorityEveryK: "priority lane",
  recoveryMinutes: "missed-turn recovery",
  equivalentGroup: "equivalent lines",
};

export function auditActionLabel(action) {
  if (!action) return "Admin action";
  return ACTION_LABELS[action] || String(action).replace(/-/g, " ");
}

export function auditMetaLine(event) {
  const meta = event?.meta || {};
  const parts = [];
  if (meta.email) parts.push(meta.email);
  if (meta.title) parts.push(`“${meta.title}”`);
  if (meta.counter) parts.push(meta.counter);
  if (meta.from && meta.to && typeof meta.from === "string" && !/^(open|break|closed)$/.test(meta.from)) {
    parts.push(`${meta.from} → ${meta.to}`);
  }
  if (meta.name && !meta.from) parts.push(meta.name);
  if (meta.person) parts.push(meta.person);
  if (meta.noShows != null) parts.push(`${meta.noShows} no-shows in ${meta.windowDays || 30} days`);
  if (meta.graceMinutes != null) parts.push(`after ${meta.graceMinutes} min`);
  if (meta.scope === "account" || meta.scope === "ip") {
    if (meta.ip) parts.push(`IP ${meta.ip}`);
    if (meta.failures != null) parts.push(`${meta.failures} failed ${meta.stage === "two-step" ? "codes" : "attempts"}`);
    if (meta.minutes != null) parts.push(`locked ${meta.minutes} min`);
  } else if (meta.scope && typeof meta.scope === "string" && !["campus", "venue", "queue"].includes(meta.scope)) parts.push(meta.scope);
  if (meta.with === "backup") parts.push("used a backup code");
  if (meta.fields) {
    const names = String(meta.fields)
      .split(/,\s*/)
      .filter((f) => f && f !== "maxWaiting")
      .map((f) => FIELD_LABELS[f] || f);
    if (names.length) parts.push(`changed ${names.join(", ")}`);
  }
  if (meta.tokenNumber != null) parts.push(`token ${meta.tokenNumber}`);
  if (meta.cleared != null) parts.push(`${meta.cleared} places cleared`);
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

function campusDayKey(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** Group events (newest first) by campus day: [{ key, label, events }]. */
export function groupAuditByDay(events, nowMs = Date.now()) {
  const today = campusDayKey(nowMs);
  const yesterday = campusDayKey(nowMs - 24 * 60 * 60 * 1000);
  const groups = [];
  for (const event of events || []) {
    if (!event?.createdAt) continue;
    const key = campusDayKey(event.createdAt);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Kolkata",
                weekday: "short",
                day: "numeric",
                month: "short",
                year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
              }).format(new Date(event.createdAt));
      group = { key, label, events: [] };
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}

/** Who did it, for one line of the log. */
export function auditActorLabel(actor) {
  if (!actor) return "Someone";
  const name = actor.name || actor.email || "Someone";
  if (actor.role === "user" || actor.role === "guest") return `${name} (student)`;
  return name;
}

/** Query string for the audit API from the page's filter state. */
export function auditQueryString(filters = {}, extra = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  return params.toString();
}
