import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { noticesForOrg, orgIdOfQueue, pickOrg, placeLabel, queuesForOrg } from "./organizations.js";

const orgs = [
  { id: "default", slug: "main", name: "Main campus" },
  { id: "o2", slug: "annex", name: "Annex" },
];
const queues = [
  { id: "q1", venue: { id: "v1", organizationId: null } },
  { id: "q2", venue: { id: "v2", organizationId: "o2" } },
];

describe("organization helpers", () => {
  it("picks from the link, then the saved choice, then the first; none with one org", () => {
    assert.equal(pickOrg(orgs, { linkSlug: "annex" }).id, "o2");
    assert.equal(pickOrg(orgs, { savedSlug: "annex" }).id, "o2");
    assert.equal(pickOrg(orgs, { linkSlug: "gone", savedSlug: "" }).id, "default");
    assert.equal(pickOrg([orgs[0]], { linkSlug: "main" }), null);
  });

  it("filters lines and notices to the chosen org", () => {
    assert.equal(orgIdOfQueue(queues[0]), "default");
    assert.deepEqual(queuesForOrg(queues, orgs[1]).map((q) => q.id), ["q2"]);
    assert.equal(queuesForOrg(queues, null).length, 2);
    const notices = [
      { id: "a", scope: "campus" },
      { id: "b", scope: "campus", organizationId: "default" },
      { id: "c", scope: "venue", venueId: "v2" },
      { id: "d", scope: "queue", queueId: "q1" },
    ];
    const annexQueues = queuesForOrg(queues, orgs[1]);
    assert.deepEqual(noticesForOrg(notices, orgs[1], annexQueues).map((n) => n.id), ["a", "c"]);
    assert.equal(placeLabel("Outpatient", orgs, "o2"), "Annex · Outpatient");
    assert.equal(placeLabel("Hub", [orgs[0]], null), "Hub");
  });
});
