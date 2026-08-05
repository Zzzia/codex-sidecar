import test from "node:test";
import assert from "node:assert/strict";
import {
  isLocalFileHref,
  localFileAnchorHref,
} from "./localFilePreview.js";

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

test("localFileAnchorHref uses non-navigating href for filesystem paths", () => {
  assert.equal(
    localFileAnchorHref(
      "/home/zia/.config/ibrain/runs/run-1/nodes/review-synthesis/output.txt",
    ),
    "#",
  );
  assert.equal(localFileAnchorHref("src/main.ts"), "#");
  assert.equal(localFileAnchorHref("https://example.com/docs"), "https://example.com/docs");
});
