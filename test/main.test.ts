import assert from "node:assert/strict";
import { test } from "node:test";

import { describeRuntime } from "../src/main.ts";

test("entry point loads without external services", () => {
  assert.match(describeRuntime(), /^venture-instinct domain runtime/);
});
