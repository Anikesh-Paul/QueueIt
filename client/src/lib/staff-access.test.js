import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { staffCanManageQueue } from "./staff-access.js";

describe("staffCanManageQueue", () => {
  const cafeteria = { id: "q-cafe", venue: { id: "v-hub" } };
  const gym = { id: "q-gym", venue: { id: "v-hub" } };
  const other = { id: "q-lib", venue: { id: "v-lib" } };

  it("lets a global admin manage any queue", () => {
    const admin = { role: "admin", staffVenueId: null, staffQueueIds: null };
    assert.equal(staffCanManageQueue(admin, cafeteria), true);
    assert.equal(staffCanManageQueue(admin, other), true);
  });

  it("lets venue-only staff manage every queue in their venue", () => {
    const staff = { role: "staff", staffVenueId: "v-hub", staffQueueIds: [] };
    assert.equal(staffCanManageQueue(staff, cafeteria), true);
    assert.equal(staffCanManageQueue(staff, gym), true);
    assert.equal(staffCanManageQueue(staff, other), false);
  });

  it("hides off-list queues in the same venue", () => {
    const staff = { role: "staff", staffVenueId: "v-hub", staffQueueIds: ["q-cafe"] };
    assert.equal(staffCanManageQueue(staff, cafeteria), true);
    assert.equal(staffCanManageQueue(staff, gym), false);
    assert.equal(staffCanManageQueue(staff, other), false);
  });
});
