import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scopeSummary, sameOrgs, sortPeople, toggleOrg, venuesByOrg } from "./org-access.js";
import { isGlobalAdmin, isOrgAdmin, staffCanManageQueue } from "./staff-access.js";
import { auditActionLabel, auditMetaLine } from "./admin-audit.js";

describe("org access helpers", () => {
  it("summarises scope for admins and staff", () => {
    assert.equal(scopeSummary({ role: "admin", scope: "global", organizations: [] }), "All organizations");
    assert.equal(
      scopeSummary({ role: "admin", scope: "organizations", organizations: [{ id: "a", name: "Annex" }, { id: "default", name: "Main campus" }] }),
      "Annex, Main campus"
    );
    assert.equal(scopeSummary({ role: "staff", venue: { name: "OPD" }, organizations: [{ id: "a", name: "Annex" }] }), "OPD · Annex");
    assert.equal(scopeSummary({ role: "staff", venue: null, organizations: [] }), "No venue");
  });

  it("toggles and compares organization lists", () => {
    assert.deepEqual(toggleOrg(["a"], "b", true), ["a", "b"]);
    assert.deepEqual(toggleOrg(["a", "b"], "a", false), ["b"]);
    assert.deepEqual(toggleOrg(["a"], "a", true), ["a"]);
    assert.equal(sameOrgs(["a", "b"], ["b", "a"]), true);
    assert.equal(sameOrgs(["a"], ["a", "b"]), false);
    assert.equal(sameOrgs([], null), true);
  });

  it("groups venues by organization, main campus for unassigned", () => {
    const groups = venuesByOrg(
      [
        { id: "v1", name: "Hub", organizationId: null },
        { id: "v2", name: "OPD", organizationId: "o1" },
      ],
      [{ id: "default", name: "Main campus" }, { id: "o1", name: "Annex" }, { id: "o2", name: "Empty" }]
    );
    assert.deepEqual(groups.map((g) => [g.name, g.venues.map((v) => v.name)]), [["Main campus", ["Hub"]], ["Annex", ["OPD"]]]);
  });

  it("sorts global admins, then scoped admins, then staff", () => {
    const sorted = sortPeople([
      { name: "Zed", role: "staff" },
      { name: "Bea", role: "admin", scope: "organizations" },
      { name: "Al", role: "admin", scope: "global" },
    ]);
    assert.deepEqual(sorted.map((p) => p.name), ["Al", "Bea", "Zed"]);
  });

  it("tells global admins from organization admins", () => {
    assert.equal(isGlobalAdmin({ role: "admin" }), true);
    assert.equal(isGlobalAdmin({ role: "admin", adminOrganizationIds: null }), true);
    assert.equal(isGlobalAdmin({ role: "admin", adminOrganizationIds: ["o1"] }), false);
    assert.equal(isOrgAdmin({ role: "admin", adminOrganizationIds: ["o1"] }), true);
    assert.equal(isOrgAdmin({ role: "staff", adminOrganizationIds: ["o1"] }), false);
  });

  it("organization admins can only manage queues in their organizations", () => {
    const annexAdmin = { role: "admin", adminOrganizationIds: ["o1"] };
    assert.equal(staffCanManageQueue(annexAdmin, { id: "q1", venue: { id: "v2", organizationId: "o1" } }), true);
    assert.equal(staffCanManageQueue(annexAdmin, { id: "q2", venue: { id: "v1", organizationId: null } }), false);
    const mainAdmin = { role: "admin", adminOrganizationIds: ["default"] };
    assert.equal(staffCanManageQueue(mainAdmin, { id: "q2", venue: { id: "v1", organizationId: null } }), true);
    assert.equal(staffCanManageQueue({ role: "admin" }, { id: "q2", venue: { id: "v1" } }), true);
  });

  it("labels assignment changes in the audit log", () => {
    assert.equal(auditActionLabel("admin-scope"), "Changed an admin's organizations");
    assert.equal(auditActionLabel("staff-move"), "Moved staff to another venue");
    assert.equal(auditActionLabel("admin-invite"), "Added an organization admin");
    assert.equal(
      auditMetaLine({ action: "admin-scope", meta: { email: "a@x.com", name: "A", from: "All organizations", to: "Annex" } }),
      "a@x.com · All organizations → Annex"
    );
    assert.equal(
      auditMetaLine({ action: "staff-move", meta: { email: "s@x.com", from: "Hub", to: "OPD", fromOrg: "Main campus", toOrg: "Annex" } }),
      "s@x.com · Hub → OPD · Main campus → Annex"
    );
    assert.equal(auditMetaLine({ action: "admin-invite", meta: { email: "n@x.com", to: "Annex" } }), "n@x.com · Annex");
  });
});
