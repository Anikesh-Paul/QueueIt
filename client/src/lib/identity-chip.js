/** Identity chip display rules — name first, role badge only when it adds information. */

export function normalizeIdentityRole(role) {
  const value = String(role || "user").toLowerCase();
  if (value === "admin") return "admin";
  if (value === "staff") return "staff";
  if (value === "guest") return "guest";
  return "user";
}

export function identityChipLabel(user = {}) {
  const role = normalizeIdentityRole(user.role);
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (name) return name;
  return role === "guest" ? "Guest" : "Account";
}

/**
 * Admin and Staff badges stay visible. Hide Guest when the label is already
 * “Guest”, and omit the User badge — it reads as the person's name on a phone.
 */
export function shouldShowRoleBadge(role, label) {
  const normalized = normalizeIdentityRole(role);
  if (normalized === "admin" || normalized === "staff") return true;
  if (normalized === "guest") return String(label || "") !== "Guest";
  return false;
}
