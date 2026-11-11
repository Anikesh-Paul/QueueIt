/**
 * How the status-page notification control should appear.
 * The enable upsell is hidden once the student has been called (the urgent
 * banner already has their attention) or shown compactly after they opt in.
 */
export function notifyControlsMode({ supported = true, permission, enabled = false, called = false } = {}) {
  if (!supported) return "unsupported";
  if (permission === "denied") return "denied";
  if (called && !enabled) return "hidden";
  if (enabled) return "compact-enabled";
  return "enable";
}
