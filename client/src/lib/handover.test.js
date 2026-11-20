import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_BODY_MAX,
  activeNotes,
  clampNoteBody,
  expiryPresetLabel,
  handoverExpiryHoursOf,
  noteState,
  sortNotes,
  unreadNotes,
} from "./handover.js";

describe("handover helpers", () => {
  it("defaults expiry to 24 hours and clamps the body", () => {
    assert.equal(handoverExpiryHoursOf({}), 24);
    assert.equal(handoverExpiryHoursOf({ handoverExpiryHours: 8 }), 8);
    assert.equal(handoverExpiryHoursOf({ handover: { expiryHours: 48 } }), 48);
    assert.equal(clampNoteBody("x".repeat(NOTE_BODY_MAX + 10)).length, NOTE_BODY_MAX);
    assert.equal(expiryPresetLabel(24), "24 hours");
    assert.equal(expiryPresetLabel(168), "7 days");
    assert.equal(expiryPresetLabel(8), "8 hours");
  });

  it("sorts pinned and important notes first, then hides resolved from the active list", () => {
    const notes = [
      { id: "a", body: "old", createdAt: "2026-11-12T01:00:00Z", important: false, pinned: false },
      { id: "b", body: "pin", createdAt: "2026-11-12T00:00:00Z", pinned: true },
      { id: "c", body: "flag", createdAt: "2026-11-12T02:00:00Z", important: true },
      { id: "d", body: "done", createdAt: "2026-11-12T03:00:00Z", resolvedAt: "2026-11-12T04:00:00Z" },
    ];
    assert.deepEqual(sortNotes(notes).map((row) => row.id), ["b", "c", "a", "d"]);
    assert.deepEqual(activeNotes(notes).map((row) => row.id), ["b", "c", "a"]);
    assert.equal(noteState({ state: "expired" }), "expired");
    assert.deepEqual(unreadNotes([{ ...notes[0], acknowledged: false }, { ...notes[1], acknowledged: true }]).map((row) => row.id), ["a"]);
  });
});
