import {
  autoDistributeWorkspace,
  closeLeafInWorkspace,
  createInitialWorkspace,
  getLeafThreadMap,
  openThreadInWorkspace,
  setActiveLeaf,
  type WorkspaceNode,
  type WorkspaceState,
} from "./workspace.js";

function collectThreadOrder(node: WorkspaceNode | null, output: string[] = []): string[] {
  if (!node) {
    return output;
  }
  if (node.type === "leaf") {
    output.push(node.threadId);
    return output;
  }
  collectThreadOrder(node.children[0], output);
  collectThreadOrder(node.children[1], output);
  return output;
}

function sameThreadOrder(root: WorkspaceNode | null, threadIds: readonly string[]): boolean {
  const current = collectThreadOrder(root);
  return (
    current.length === threadIds.length &&
    current.every((threadId, index) => threadId === threadIds[index])
  );
}

function rebuildWorkspaceInThreadOrder(
  state: WorkspaceState,
  threadIds: readonly string[],
): WorkspaceState {
  const currentLeafThreads = getLeafThreadMap(state.root);
  const activeThreadId = state.activeLeafId
    ? currentLeafThreads[state.activeLeafId] ?? null
    : null;
  let next = createInitialWorkspace();

  for (const threadId of threadIds) {
    next = openThreadInWorkspace(next, threadId);
  }

  if (!activeThreadId) {
    return next;
  }

  const nextActiveLeafId =
    Object.entries(getLeafThreadMap(next.root)).find(
      ([, threadId]) => threadId === activeThreadId,
    )?.[0] ?? null;

  return nextActiveLeafId ? setActiveLeaf(next, nextActiveLeafId) : next;
}

export function reconcileWorkspaceToThreads(
  state: WorkspaceState,
  threadIds: readonly string[],
): WorkspaceState {
  const desiredThreads = new Set(threadIds);
  let next = state.root ? state : createInitialWorkspace();

  for (const [leafId, threadId] of Object.entries(getLeafThreadMap(next.root))) {
    if (!desiredThreads.has(threadId)) {
      next = closeLeafInWorkspace(next, leafId);
    }
  }

  const currentThreads = new Set(Object.values(getLeafThreadMap(next.root)));
  for (const threadId of threadIds) {
    if (!currentThreads.has(threadId)) {
      next = openThreadInWorkspace(next, threadId);
      currentThreads.add(threadId);
    }
  }

  if (!sameThreadOrder(next.root, threadIds)) {
    next = rebuildWorkspaceInThreadOrder(next, threadIds);
  }

  return autoDistributeWorkspace(next);
}
