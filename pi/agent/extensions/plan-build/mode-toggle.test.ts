import assert from "node:assert/strict";
import test from "node:test";
import { createModeToggleGuard } from "./mode-toggle.ts";

test("suppresses duplicate terminal key-repeat events", () => {
  let now = 1_000;
  const shouldToggle = createModeToggleGuard(200, () => now);

  assert.equal(shouldToggle(), true);

  now += 25;
  assert.equal(shouldToggle(), false);

  now += 175;
  assert.equal(shouldToggle(), true);
});
