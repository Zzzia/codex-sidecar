import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialWorkspace,
  openThreadInWorkspace,
  updateSplitSizes,
} from "./workspace.js";
import { reconcileWorkspaceToThreads } from "./workspaceReconcile.js";

function assertSizesClose(actual: [number, number], expected: [number, number]) {
  assert.ok(Math.abs(actual[0] - expected[0]) < 0.001);
  assert.ok(Math.abs(actual[1] - expected[1]) < 0.001);
}

test("reconcileWorkspaceToThreads redistributes existing panes evenly", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");
  state = openThreadInWorkspace(state, "thread-c");

  if (state.root?.type !== "split") {
    assert.fail("expected split root before reconcile");
  }

  state = updateSplitSizes(state, state.root.id, [82, 18]);
  const reconciled = reconcileWorkspaceToThreads(state, [
    "thread-a",
    "thread-b",
    "thread-c",
  ]);

  if (
    reconciled.root?.type !== "split" ||
    reconciled.root.children[1]?.type !== "split"
  ) {
    assert.fail("expected nested split after reconcile");
  }

  assertSizesClose(reconciled.root.sizes, [100 / 3, 200 / 3]);
  assert.deepEqual(reconciled.root.children[1].sizes, [50, 50]);
});

test("reconcileWorkspaceToThreads reorders existing panes to match requested order", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");
  state = openThreadInWorkspace(state, "thread-c");

  const reconciled = reconcileWorkspaceToThreads(state, [
    "thread-c",
    "thread-a",
    "thread-b",
  ]);

  if (
    reconciled.root?.type !== "split" ||
    reconciled.root.children[1]?.type !== "split"
  ) {
    assert.fail("expected nested split after reconcile");
  }

  const firstPane = reconciled.root.children[0];
  const secondGroup = reconciled.root.children[1];
  if (
    firstPane.type !== "leaf" ||
    secondGroup.type !== "split" ||
    secondGroup.children[0].type !== "leaf" ||
    secondGroup.children[1].type !== "leaf"
  ) {
    assert.fail("expected reordered leaf panes");
  }

  assert.equal(firstPane.threadId, "thread-c");
  assert.equal(secondGroup.children[0].threadId, "thread-a");
  assert.equal(secondGroup.children[1].threadId, "thread-b");
});
