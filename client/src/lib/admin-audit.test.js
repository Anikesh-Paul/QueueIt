import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditActionLabel, auditMetaLine } from "./admin-audit.js";

describe("admin audit copy", () => {
  it("labels known actions and summarizes safe meta", () => {
    assert.equal(auditActionLabel("pause"), "Paused the queue");
    assert.equal(auditMetaLine({ meta: { tokenNumber: 12 } }), "token 12");
    assert.equal(auditMetaLine({ meta: { cleared: 3 } }), "3 places cleared");
  });
});

describe("audit log page helpers", async () => {
  const { auditActorLabel, auditQueryString, groupAuditByDay } = await import("./admin-audit.js");

  it("describes new actions with their details", () => {
    assert.equal(auditActionLabel("counter-rename"), "Renamed a counter");
    assert.equal(auditMetaLine({ meta: { from: "Window B", to: "Window C" } }), "Window B → Window C");
    assert.equal(auditMetaLine({ meta: { counter: "Counter 1", from: "open", to: "break" } }), "Counter 1");
    assert.equal(
      auditMetaLine({ meta: { fields: "averageServiceTime, guestJoin, maxWaiting", maxWaiting: 40 } }),
      "changed service time, guest joining · cap 40"
    );
    assert.equal(auditMetaLine({ meta: { email: "a@b.c", scope: "1 queue" } }), "a@b.c · 1 queue");
    assert.equal(auditActorLabel({ name: "Riya", role: "user" }), "Riya (student)");
    assert.equal(auditActorLabel({ email: "x@y.z", role: "staff" }), "x@y.z");
  });

  it("groups by campus day with Today and Yesterday", () => {
    const now = Date.parse("2026-11-12T10:00:00Z"); // 15:30 IST
    const groups = groupAuditByDay(
      [
        { id: "1", createdAt: "2026-11-12T09:00:00Z" },
        { id: "2", createdAt: "2026-11-11T19:00:00Z" }, // 00:30 IST on the 12th
        { id: "3", createdAt: "2026-11-11T18:00:00Z" }, // 23:30 IST on the 11th
        { id: "4", createdAt: "2026-11-09T05:00:00Z" },
      ],
      now
    );
    assert.deepEqual(groups.map((g) => [g.label, g.events.length]), [
      ["Today", 2],
      ["Yesterday", 1],
      ["Mon 9 Nov", 1],
    ]);
    assert.equal(auditQueryString({ category: "settings", actorId: "", from: "2026-11-01" }, { limit: 30 }), "category=settings&from=2026-11-01&limit=30");
  });
});
