import test from "node:test";
import assert from "node:assert/strict";
import { isLocalFileHref } from "./localFilePreview.js";

test("isLocalFileHref detects local workspace links", () => {
  assert.equal(isLocalFileHref("src/main.ts"), true);
  assert.equal(isLocalFileHref("/home/zia/project/app/src/main.ts:12"), true);
  assert.equal(isLocalFileHref("file:///home/zia/project/app/README.md"), true);
});

test("isLocalFileHref ignores anchors and external links", () => {
  assert.equal(isLocalFileHref("#section"), false);
  assert.equal(isLocalFileHref("https://example.com"), false);
  assert.equal(isLocalFileHref("mailto:test@example.com"), false);
});
