import test from "node:test";
import assert from "node:assert/strict";
import { prepareDiffView } from "./diffViewData";

test("prepareDiffView synthesizes headers for hunk-only updates", () => {
  const prepared = prepareDiffView(
    "src/demo.ts",
    "@@ -1,1 +1,1 @@\n-old\n+new",
    "update",
  );

  assert.ok(prepared.diffFile);
  assert.equal(prepared.note, null);
  assert.equal(prepared.diffFile?.unifiedLineLength, 2);
});

test("prepareDiffView renders hunk-only updates ending with a blank context line", () => {
  const prepared = prepareDiffView(
    "Halo/app/build.gradle.kts",
    [
      "@@ -15,4 +15,4 @@",
      "         targetSdk = 35",
      '-        versionCode = 4',
      '-        versionName = "1.1"',
      '+        versionCode = 5',
      '+        versionName = "1.2"',
      " ",
    ].join("\n"),
    "update",
  );

  assert.ok(prepared.diffFile);
  assert.equal(prepared.note, null);
  assert.equal(prepared.diffFile?.unifiedLineLength, 6);
});

test("prepareDiffView strips trailing move notes from unified diffs", () => {
  const prepared = prepareDiffView(
    "src/demo.ts",
    [
      "--- a/src/demo.ts",
      "+++ b/src/demo.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
      "Moved to: src/demo-renamed.ts",
    ].join("\n"),
    "update",
  );

  assert.ok(prepared.diffFile);
  assert.equal(prepared.note, "Moved to: src/demo-renamed.ts");
  assert.equal(prepared.diffFile?.unifiedLineLength, 2);
});

test("prepareDiffView falls back to raw text for non-hunk diffs", () => {
  const prepared = prepareDiffView(
    "src/demo.bin",
    "Binary files a/src/demo.bin and b/src/demo.bin differ",
    "update",
  );

  assert.equal(prepared.diffFile, null);
  assert.match(prepared.fallbackText, /Binary files/);
});

test("prepareDiffView normalizes bare @@ multi-hunk Codex apply_patch diffs", () => {
  const prepared = prepareDiffView(
    "design.md",
    [
      "--- a/design.md",
      "+++ b/design.md",
      "@@",
      "-## 5. 状态与发布流程",
      "+## 6. 状态与发布流程",
      "@@",
      "-## 6. 数据与接口边界",
      "+## 7. 数据与接口边界",
      "@@",
      "-## 7. 各仓改造",
      "+## 8. 各仓改造",
    ].join("\n"),
    "update",
  );

  assert.ok(prepared.diffFile, "expected structured DiffFile for bare @@ hunks");
  assert.equal(prepared.note, null);
  // Three one-line replacements → six unified lines.
  assert.equal(prepared.diffFile?.unifiedLineLength, 6);
  assert.match(prepared.fallbackText, /@@ -1,1 \+1,1 @@/);
  assert.match(prepared.fallbackText, /@@ -2,1 \+2,1 @@/);
  assert.match(prepared.fallbackText, /@@ -3,1 \+3,1 @@/);
});

test("prepareDiffView keeps already-valid hunk headers intact", () => {
  const prepared = prepareDiffView(
    "src/demo.ts",
    [
      "--- a/src/demo.ts",
      "+++ b/src/demo.ts",
      "@@ -10,2 +10,2 @@",
      "-old",
      "+new",
    ].join("\n"),
    "update",
  );

  assert.ok(prepared.diffFile);
  assert.match(prepared.fallbackText, /@@ -10,2 \+10,2 @@/);
});
