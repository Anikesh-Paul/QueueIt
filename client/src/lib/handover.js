export const NOTE_BODY_MAX = 500;
export const EXPIRY_PRESETS = [4, 8, 12, 24, 48, 72, 168];

export function handoverExpiryHoursOf(queue) {
  const n = Number(queue?.handoverExpiryHours ?? queue?.handover?.expiryHours);
  if (Number.isInteger(n) && n >= 1 && n <= 168) return n;
  return 24;
}

export function noteState(note, at = Date.now()) {
  if (note?.resolvedAt || note?.state === "resolved") return "resolved";
  if (note?.state === "expired") return "expired";
  if (note?.expiresAt && new Date(note.expiresAt).getTime() <= at) return "expired";
  return "active";
}

export function sortNotes(notes = []) {
  return [...notes].sort((a, b) => {
    const stateRank = (row) => (noteState(row) === "active" ? 0 : 1);
    const byState = stateRank(a) - stateRank(b);
    if (byState) return byState;
    const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pin) return pin;
    const imp = Number(Boolean(b.important)) - Number(Boolean(a.important));
    if (imp) return imp;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

export function activeNotes(notes = [], at = Date.now()) {
  return sortNotes(notes).filter((row) => noteState(row, at) === "active");
}

export function unreadNotes(notes = [], at = Date.now()) {
  return activeNotes(notes, at).filter((row) => !row.acknowledged);
}

export function clampNoteBody(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n/g, "\n").slice(0, NOTE_BODY_MAX);
}

export function expiryPresetLabel(hours, t) {
  if (hours === 24 && t) return t("handover.hours24");
  if (hours === 168 && t) return t("handover.hours168");
  if (t) return t("handover.hours", { n: hours });
  if (hours === 24) return "24 hours";
  if (hours === 168) return "7 days";
  return `${hours} hours`;
}
