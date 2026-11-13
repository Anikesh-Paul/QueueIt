import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_SNAPSHOT_KEY,
  SNAPSHOT_MAX_AGE_MS,
  actionErrorMessage,
  clearCachedUser,
  clearStatusSnapshot,
  formatAsOf,
  isOfflineError,
  loadCachedUser,
  loadStatusSnapshot,
  offlineActionMessage,
  saveCachedUser,
  saveStatusSnapshot,
  snapshotIdentity,
} from "./offline.js";
import {
  INSTALL_SNOOZE_MS,
  dismissInstall,
  readInstallDismissedAt,
  shouldOfferInstall,
} from "./install-prompt.js";

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const row = (id, position) => ({ queue: { id, name: `Q${id}` }, entry: { ticketNumber: 7 }, position });

describe("isOfflineError", () => {
  it("recognises the typed offline error and raw fetch failures", () => {
    assert.equal(isOfflineError(Object.assign(new Error("x"), { offline: true })), true);
    assert.equal(isOfflineError(new TypeError("Failed to fetch")), true);
    assert.equal(isOfflineError(new TypeError("NetworkError when attempting to fetch resource.")), true);
  });
  it("does not treat HTTP errors as offline", () => {
    assert.equal(isOfflineError(Object.assign(new Error("Queue is closed"), { status: 409 })), false);
    assert.equal(isOfflineError(Object.assign(new Error("Failed to fetch"), { status: 500 })), false);
    assert.equal(isOfflineError(null), false);
  });
});

describe("status snapshot", () => {
  const me = snapshotIdentity({ token: "header.payload.signature-abcdef" });
  const guest = snapshotIdentity({ guestCredential: "guest-cred-123456789" });

  it("identity prefers the JWT, then the guest credential", () => {
    assert.match(me, /^token:/);
    assert.match(guest, /^guest:/);
    assert.equal(snapshotIdentity({}), null);
  });

  it("round-trips the last known places for the same person", () => {
    const storage = memoryStorage();
    assert.equal(saveStatusSnapshot(storage, me, [row("a", 3), row("b", 1)], 1000), true);
    const snap = loadStatusSnapshot(storage, me, { now: 2000 });
    assert.equal(snap.savedAt, 1000);
    assert.deepEqual(snap.memberships.map((m) => m.position), [3, 1]);
  });

  it("never shows one person's ticket to another", () => {
    const storage = memoryStorage();
    saveStatusSnapshot(storage, me, [row("a", 3)], 1000);
    assert.equal(loadStatusSnapshot(storage, guest, { now: 2000 }), null);
    assert.equal(loadStatusSnapshot(storage, null, { now: 2000 }), null);
  });

  it("expires old snapshots and ignores junk", () => {
    const storage = memoryStorage();
    saveStatusSnapshot(storage, me, [row("a", 3)], 0);
    assert.equal(loadStatusSnapshot(storage, me, { now: SNAPSHOT_MAX_AGE_MS + 1 }), null);
    storage.setItem(OFFLINE_SNAPSHOT_KEY, "{not json");
    assert.equal(loadStatusSnapshot(storage, me), null);
  });

  it("an empty list (left the line) removes the snapshot", () => {
    const storage = memoryStorage();
    saveStatusSnapshot(storage, me, [row("a", 3)], 1000);
    saveStatusSnapshot(storage, me, [], 2000);
    assert.equal(storage.map.has(OFFLINE_SNAPSHOT_KEY), false);
    saveStatusSnapshot(storage, me, [row("a", 3)], 1000);
    clearStatusSnapshot(storage);
    assert.equal(storage.map.has(OFFLINE_SNAPSHOT_KEY), false);
  });

  it("survives blocked storage", () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
    assert.equal(saveStatusSnapshot(broken, me, [row("a", 1)]), false);
    assert.equal(loadStatusSnapshot(broken, me), null);
  });
});

describe("cached profile for offline boot", () => {
  it("only restores the profile for the same token", () => {
    const storage = memoryStorage();
    saveCachedUser(storage, "tok-1111111111111111", { id: "u1", name: "Asha", email: "a@x", role: "user", extra: "x" });
    assert.deepEqual(loadCachedUser(storage, "tok-1111111111111111"), { id: "u1", name: "Asha", email: "a@x", role: "user" });
    assert.equal(loadCachedUser(storage, "tok-2222222222222222"), null);
    clearCachedUser(storage);
    assert.equal(loadCachedUser(storage, "tok-1111111111111111"), null);
  });
});

describe("offline copy", () => {
  it("explains join and leave in English and Hindi", () => {
    assert.match(offlineActionMessage("join", "en"), /offline.*couldn’t join/i);
    assert.match(offlineActionMessage("leave", "en"), /still in line/);
    assert.match(offlineActionMessage("leave", "hi"), /ऑफ़लाइन/);
    assert.match(offlineActionMessage("other", "en"), /Reconnect/);
  });
  it("keeps server messages for real errors", () => {
    const offline = Object.assign(new Error("x"), { offline: true });
    assert.equal(actionErrorMessage(offline, "join", "en", "f"), offlineActionMessage("join", "en"));
    assert.equal(actionErrorMessage(Object.assign(new Error("Queue is full"), { status: 409 }), "join", "en", "f"), "Queue is full");
    assert.equal(actionErrorMessage({ status: 500 }, "join", "en", "fallback"), "fallback");
  });
  it("formats the as-of time in campus time", () => {
    // 2026-03-01T05:30:00Z is 11:00 in Asia/Kolkata.
    assert.match(formatAsOf(Date.parse("2026-03-01T05:30:00Z"), "en"), /11:00/);
    assert.equal(formatAsOf(null), null);
    assert.equal(formatAsOf(NaN), null);
  });
});

describe("install prompt rules", () => {
  it("offers only when available, not installed and not snoozed", () => {
    assert.equal(shouldOfferInstall({ available: true, standalone: false, dismissedAt: null }), true);
    assert.equal(shouldOfferInstall({ available: false, standalone: false }), false);
    assert.equal(shouldOfferInstall({ available: true, standalone: true }), false);
    assert.equal(shouldOfferInstall({ available: true, standalone: false, dismissedAt: 1000, now: 2000 }), false);
    assert.equal(
      shouldOfferInstall({ available: true, standalone: false, dismissedAt: 1000, now: 1000 + INSTALL_SNOOZE_MS + 1 }),
      true
    );
  });
  it("remembers a dismissal", () => {
    const storage = memoryStorage();
    dismissInstall(storage, 12345);
    assert.equal(readInstallDismissedAt(storage), 12345);
    assert.equal(readInstallDismissedAt(memoryStorage()), null);
  });
});
