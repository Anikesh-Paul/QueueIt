import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notifyControlsMode } from "./notify-controls.js";

describe("notifyControlsMode", () => {
  it("hides the enable upsell once the student has been called", () => {
    assert.equal(
      notifyControlsMode({ supported: true, enabled: false, called: true }),
      "hidden"
    );
  });

  it("keeps compact controls when notifications are already on, even if called", () => {
    assert.equal(
      notifyControlsMode({ supported: true, enabled: true, called: true }),
      "compact-enabled"
    );
  });

  it("shows the enable control while waiting without permission", () => {
    assert.equal(
      notifyControlsMode({ supported: true, enabled: false, called: false }),
      "enable"
    );
  });

  it("reports unsupported and denied states", () => {
    assert.equal(notifyControlsMode({ supported: false }), "unsupported");
    assert.equal(
      notifyControlsMode({ supported: true, permission: "denied" }),
      "denied"
    );
  });
});
