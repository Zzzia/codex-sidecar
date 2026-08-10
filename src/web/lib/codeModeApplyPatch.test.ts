import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNestedApplyPatches,
  hasNestedApplyPatchCall,
  isApplyPatchOnlyCodeModeScript,
  patchChangesFromInvocation,
  patchFilePathsFromInvocation,
  summarizePatchInvocation,
} from "./codeModeApplyPatch.js";

const SAMPLE_PATCH = `*** Begin Patch
*** Add File: /tmp/demo.ts
+export const n = 1;
*** End Patch`;

test("extractNestedApplyPatches reads inline string arguments", () => {
  const script = `text(await tools.apply_patch(${JSON.stringify(SAMPLE_PATCH)}));`;
  const patches = extractNestedApplyPatches(script);
  assert.equal(patches.length, 1);
  assert.ok(patches[0]?.patchText.includes("*** Add File: /tmp/demo.ts"));
});

test("extractNestedApplyPatches resolves const patch bindings", () => {
  const script = `const patch = ${JSON.stringify(SAMPLE_PATCH)};
text(await tools.apply_patch(patch));
`;
  const patches = extractNestedApplyPatches(script);
  assert.equal(patches.length, 1);
  assert.deepEqual(patchFilePathsFromInvocation(patches[0]?.patchText ?? ""), [
    "/tmp/demo.ts",
  ]);
});

test("extractNestedApplyPatches supports template-literal bindings", () => {
  const script = `const patch = \`*** Begin Patch
*** Delete File: /tmp/old.ts
*** End Patch\`;
const result = await tools.apply_patch(patch);
text(result);
`;
  const patches = extractNestedApplyPatches(script);
  assert.equal(patches.length, 1);
  assert.equal(summarizePatchInvocation(patches[0]?.patchText ?? ""), "old.ts");
});

test("hasNestedApplyPatchCall detects unresolved references", () => {
  const script = `const dir = load("d");
const patch = \`*** Begin Patch
*** Add File: \${dir}/x.ts
+hi
*** End Patch\`;
await tools.apply_patch(patch);
`;
  assert.equal(hasNestedApplyPatchCall(script), true);
  // Template is still a string literal assignment, so extraction succeeds with placeholder path.
  assert.equal(extractNestedApplyPatches(script).length, 1);
});

test("isApplyPatchOnlyCodeModeScript ignores shell work", () => {
  const onlyPatch = `const patch = ${JSON.stringify(SAMPLE_PATCH)};
text(await tools.apply_patch(patch));
`;
  assert.equal(isApplyPatchOnlyCodeModeScript(onlyPatch, false), true);
  assert.equal(isApplyPatchOnlyCodeModeScript(onlyPatch, true), false);
});

test("patchChangesFromInvocation builds add file diffs", () => {
  const changes = patchChangesFromInvocation(SAMPLE_PATCH);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.changeType, "add");
  assert.equal(changes[0]?.displayPath, "demo.ts");
  assert.ok(changes[0]?.unifiedDiff.includes("+export const n = 1;"));
});

test("patchChangesFromInvocation builds update hunks", () => {
  const patch = `*** Begin Patch
*** Update File: /home/zia/project/app/src/a.ts
@@
-const a = 1;
+const a = 2;
*** End Patch`;
  const changes = patchChangesFromInvocation(patch);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.changeType, "update");
  assert.ok(changes[0]?.unifiedDiff.includes("-const a = 1;"));
  assert.ok(changes[0]?.unifiedDiff.includes("+const a = 2;"));
});
