import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOME_LANDING, homeRedirectTarget } from "./home-redirect.js";

describe("homeRedirectTarget", () => {
  it("shows signed-out visitors the landing page", () => {
    assert.equal(
      homeRedirectTarget({ user: null, isGuest: false, isAdmin: false, inQueue: false, membershipsReady: false }),
      HOME_LANDING
    );
  });

  it("shows a guest who is not in line the landing page once memberships are ready", () => {
    assert.equal(
      homeRedirectTarget({ user: null, isGuest: true, isAdmin: false, inQueue: false, membershipsReady: true }),
      HOME_LANDING
    );
  });

  it("waits on a guest's memberships before choosing landing or status", () => {
    assert.equal(
      homeRedirectTarget({ user: null, isGuest: true, isAdmin: false, inQueue: false, membershipsReady: false }),
      null
    );
  });

  it("treats missing input as signed out", () => {
    assert.equal(homeRedirectTarget(), HOME_LANDING);
  });

  it("sends admins to the catalog without waiting on memberships", () => {
    assert.equal(
      homeRedirectTarget({
        user: { role: "admin" },
        isGuest: false,
        isAdmin: true,
        inQueue: true,
        membershipsReady: false,
      }),
      "/queues"
    );
  });

  it("waits while student memberships are still loading", () => {
    assert.equal(
      homeRedirectTarget({
        user: { role: "user" },
        isGuest: false,
        isAdmin: false,
        inQueue: false,
        membershipsReady: false,
      }),
      null
    );
  });

  it("does not treat a not-yet-restored inQueue=false as the catalog", () => {
    assert.equal(
      homeRedirectTarget({
        user: { role: "user" },
        isGuest: false,
        isAdmin: false,
        inQueue: false,
        membershipsReady: false,
      }),
      null
    );
  });

  it("sends an in-line student to /status once memberships are ready", () => {
    assert.equal(
      homeRedirectTarget({
        user: { role: "user" },
        isGuest: false,
        isAdmin: false,
        inQueue: true,
        membershipsReady: true,
      }),
      "/status"
    );
  });

  it("sends a student who is not in line to /queues once ready", () => {
    assert.equal(
      homeRedirectTarget({
        user: { role: "user" },
        isGuest: false,
        isAdmin: false,
        inQueue: false,
        membershipsReady: true,
      }),
      "/queues"
    );
  });

  it("treats a guest like a student for in-line redirect", () => {
    assert.equal(
      homeRedirectTarget({
        user: null,
        isGuest: true,
        isAdmin: false,
        inQueue: true,
        membershipsReady: true,
      }),
      "/status"
    );
  });
});
