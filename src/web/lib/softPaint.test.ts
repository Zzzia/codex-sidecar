import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseSoftPaint } from "./softPaint.js";

test("shouldUseSoftPaint returns false without a document (Node/SSR)", () => {
  assert.equal(shouldUseSoftPaint(), false);
});
