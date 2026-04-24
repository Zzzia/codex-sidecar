import test from "node:test";
import assert from "node:assert/strict";
import {
  autoDistributeWorkspace,
  closeLeafInWorkspace,
  createInitialWorkspace,
  openThreadInWorkspace,
  swapWithSibling,
  toggleLeafCollapse,
  toggleParentOrientation,
  updateSplitSizes,
} from "./workspace.js";

function assertSizesClose(actual: [number, number], expected: [number, number]) {
  assert.ok(Math.abs(actual[0] - expected[0]) < 0.001);
  assert.ok(Math.abs(actual[1] - expected[1]) < 0.001);
}

test("openThreadInWorkspace focuses existing pane instead of duplicating thread", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");
  const reopened = openThreadInWorkspace(state, "thread-a");

  assert.equal(reopened.root?.type, "split");
  if (reopened.root?.type !== "split") {
    assert.fail("expected split root");
  }

  const threadIds = reopened.root.children.map((child) =>
    child.type === "leaf" ? child.threadId : "nested",
  );
  assert.deepEqual(threadIds.sort(), ["thread-a", "thread-b"]);
});

test("openThreadInWorkspace distributes panes after adding a nested thread", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");
  state = openThreadInWorkspace(state, "thread-c");

  if (state.root?.type !== "split" || state.root.children[1]?.type !== "split") {
    assert.fail("expected nested split after opening third thread");
  }

  assertSizesClose(state.root.sizes, [100 / 3, 200 / 3]);
  assert.deepEqual(state.root.children[1].sizes, [50, 50]);
});

test("toggleLeafCollapse shrinks and restores sibling layout", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");

  if (state.root?.type !== "split" || state.root.children[0]?.type !== "leaf") {
    assert.fail("expected initial split");
  }

  const targetId = state.root.children[0].id;
  const collapsed = toggleLeafCollapse(state, targetId);
  assert.equal(collapsed.root?.type, "split");
  if (collapsed.root?.type !== "split") {
    assert.fail("expected split after collapse");
  }
  assert.deepEqual(collapsed.root.sizes, [12, 88]);

  const expanded = toggleLeafCollapse(collapsed, targetId);
  assert.equal(expanded.root?.type, "split");
  if (expanded.root?.type !== "split") {
    assert.fail("expected split after expand");
  }
  assert.deepEqual(expanded.root.sizes, [50, 50]);
});

test("closeLeafInWorkspace compresses parent and keeps sibling", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");

  if (state.root?.type !== "split" || state.root.children[1]?.type !== "leaf") {
    assert.fail("expected split before close");
  }

  const closed = closeLeafInWorkspace(state, state.root.children[1].id);
  assert.equal(closed.root?.type, "leaf");
  if (closed.root?.type !== "leaf") {
    assert.fail("expected leaf after close");
  }
  assert.equal(closed.root.threadId, "thread-a");
});

test("swapWithSibling flips leaf positions inside same split", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");

  if (state.root?.type !== "split" || state.root.children[0]?.type !== "leaf") {
    assert.fail("expected split before swap");
  }

  const swapped = swapWithSibling(state, state.root.children[0].id);
  assert.equal(swapped.root?.type, "split");
  if (swapped.root?.type !== "split") {
    assert.fail("expected split after swap");
  }

  const leftThread =
    swapped.root.children[0].type === "leaf"
      ? swapped.root.children[0].threadId
      : null;
  assert.equal(leftThread, "thread-b");
});

test("updateSplitSizes keeps workspace identity when layout does not change", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");

  if (state.root?.type !== "split") {
    assert.fail("expected split before layout update");
  }

  const unchanged = updateSplitSizes(state, state.root.id, [50, 50]);
  assert.equal(unchanged, state);

  const changed = updateSplitSizes(state, state.root.id, [45, 55]);
  assert.notEqual(changed, state);
  assert.equal(changed.root?.type, "split");
  if (changed.root?.type !== "split") {
    assert.fail("expected split after layout update");
  }
  assert.deepEqual(changed.root.sizes, [45, 55]);
});

test("autoDistributeWorkspace balances nested panes and restores collapsed panes", () => {
  let state = createInitialWorkspace();
  state = openThreadInWorkspace(state, "thread-a");
  state = openThreadInWorkspace(state, "thread-b");
  state = openThreadInWorkspace(state, "thread-c");

  if (state.root?.type !== "split" || state.root.children[1]?.type !== "split") {
    assert.fail("expected nested split before auto distribution");
  }

  const nestedSplit = state.root.children[1];
  if (nestedSplit.children[0].type !== "leaf") {
    assert.fail("expected leaf inside nested split");
  }

  state = updateSplitSizes(state, state.root.id, [80, 20]);
  state = toggleParentOrientation(state, nestedSplit.children[0].id);
  state = toggleLeafCollapse(state, nestedSplit.children[0].id);

  const balanced = autoDistributeWorkspace(state);
  if (
    balanced.root?.type !== "split" ||
    balanced.root.children[1]?.type !== "split"
  ) {
    assert.fail("expected nested split after auto distribution");
  }

  assertSizesClose(balanced.root.sizes, [100 / 3, 200 / 3]);

  const balancedNestedSplit = balanced.root.children[1];
  assert.equal(balancedNestedSplit.orientation, "vertical");
  assert.deepEqual(balancedNestedSplit.sizes, [50, 50]);
  assert.equal(balancedNestedSplit.lastExpandedSizes, undefined);

  const restoredLeaf = balancedNestedSplit.children[0];
  if (restoredLeaf.type !== "leaf") {
    assert.fail("expected restored leaf after auto distribution");
  }
  assert.equal(restoredLeaf.collapsed, false);
});
