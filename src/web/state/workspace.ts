export type PaneOrientation = "horizontal" | "vertical";

export interface WorkspaceLeaf {
  type: "leaf";
  id: string;
  threadId: string;
  collapsed: boolean;
}

export interface WorkspaceSplit {
  type: "split";
  id: string;
  orientation: PaneOrientation;
  sizes: [number, number];
  revision: number;
  lastExpandedSizes?: [number, number];
  children: [WorkspaceNode, WorkspaceNode];
}

export type WorkspaceNode = WorkspaceLeaf | WorkspaceSplit;

export interface WorkspaceState {
  root: WorkspaceNode | null;
  activeLeafId: string | null;
}

const SIDEBAR_STORAGE_KEY = "codex-app.workspace.v1";
const LAYOUT_SIZE_EPSILON = 0.1;

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function createLeaf(threadId: string): WorkspaceLeaf {
  return {
    type: "leaf",
    id: createId("pane"),
    threadId,
    collapsed: false,
  };
}

function findLeafByThread(
  node: WorkspaceNode | null,
  threadId: string,
): WorkspaceLeaf | null {
  if (!node) {
    return null;
  }
  if (node.type === "leaf") {
    return node.threadId === threadId ? node : null;
  }
  return (
    findLeafByThread(node.children[0], threadId) ??
    findLeafByThread(node.children[1], threadId)
  );
}

function mapNode(
  node: WorkspaceNode,
  targetId: string,
  updater: (node: WorkspaceNode) => WorkspaceNode,
): WorkspaceNode {
  if (node.id === targetId) {
    return updater(node);
  }

  if (node.type === "leaf") {
    return node;
  }

  return {
    ...node,
    children: [
      mapNode(node.children[0], targetId, updater),
      mapNode(node.children[1], targetId, updater),
    ],
  };
}

function replaceLeafWithSplit(
  node: WorkspaceNode,
  leafId: string,
  newThreadId: string,
): WorkspaceNode {
  if (node.type === "leaf") {
    if (node.id !== leafId) {
      return node;
    }

    return {
      type: "split",
      id: createId("split"),
      orientation: "horizontal",
      sizes: [50, 50],
      revision: 1,
      children: [node, createLeaf(newThreadId)],
    };
  }

  return {
    ...node,
    children: [
      replaceLeafWithSplit(node.children[0], leafId, newThreadId),
      replaceLeafWithSplit(node.children[1], leafId, newThreadId),
    ],
  };
}

interface ParentSearchResult {
  parent: WorkspaceSplit | null;
  index: 0 | 1;
}

function findParent(
  node: WorkspaceNode | null,
  leafId: string,
  parent: WorkspaceSplit | null = null,
  index: 0 | 1 = 0,
): ParentSearchResult | null {
  if (!node) {
    return null;
  }

  if (node.type === "leaf") {
    return node.id === leafId ? { parent, index } : null;
  }

  return (
    findParent(node.children[0], leafId, node, 0) ??
    findParent(node.children[1], leafId, node, 1)
  );
}

function updateParentSplit(
  node: WorkspaceNode,
  leafId: string,
  updater: (split: WorkspaceSplit, index: 0 | 1) => WorkspaceSplit,
): WorkspaceNode {
  if (node.type === "leaf") {
    return node;
  }

  if (
    node.children[0].type === "leaf" &&
    node.children[0].id === leafId
  ) {
    return updater(node, 0);
  }

  if (
    node.children[1].type === "leaf" &&
    node.children[1].id === leafId
  ) {
    return updater(node, 1);
  }

  return {
    ...node,
    children: [
      updateParentSplit(node.children[0], leafId, updater),
      updateParentSplit(node.children[1], leafId, updater),
    ],
  };
}

function removeLeaf(node: WorkspaceNode, leafId: string): WorkspaceNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }

  const left = removeLeaf(node.children[0], leafId);
  const right = removeLeaf(node.children[1], leafId);

  if (!left && !right) {
    return null;
  }
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    ...node,
    children: [left, right],
  };
}

function firstLeafId(node: WorkspaceNode | null): string | null {
  if (!node) {
    return null;
  }
  if (node.type === "leaf") {
    return node.id;
  }
  return firstLeafId(node.children[0]) ?? firstLeafId(node.children[1]);
}

export function createInitialWorkspace(): WorkspaceState {
  return {
    root: null,
    activeLeafId: null,
  };
}

export function openThreadInWorkspace(
  state: WorkspaceState,
  threadId: string,
): WorkspaceState {
  const existing = findLeafByThread(state.root, threadId);
  if (existing) {
    return {
      ...state,
      activeLeafId: existing.id,
    };
  }

  if (!state.root) {
    const leaf = createLeaf(threadId);
    return {
      root: leaf,
      activeLeafId: leaf.id,
    };
  }

  const targetLeafId = state.activeLeafId ?? firstLeafId(state.root);
  if (!targetLeafId) {
    return state;
  }

  const nextRoot = replaceLeafWithSplit(state.root, targetLeafId, threadId);

  return {
    root: nextRoot,
    activeLeafId: findLeafByThread(nextRoot, threadId)?.id ?? state.activeLeafId,
  };
}

export function setActiveLeaf(
  state: WorkspaceState,
  leafId: string,
): WorkspaceState {
  return {
    ...state,
    activeLeafId: leafId,
  };
}

export function closeLeafInWorkspace(
  state: WorkspaceState,
  leafId: string,
): WorkspaceState {
  const root = state.root ? removeLeaf(state.root, leafId) : null;
  return {
    root,
    activeLeafId: firstLeafId(root),
  };
}

export function updateSplitSizes(
  state: WorkspaceState,
  splitId: string,
  sizes: [number, number],
): WorkspaceState {
  if (!state.root) {
    return state;
  }

  let changed = false;
  const nextRoot = mapNode(state.root, splitId, (node) => {
    if (node.type !== "split") {
      return node;
    }

    const [left, right] = node.sizes;
    const [nextLeft, nextRight] = sizes;
    if (
      Math.abs(left - nextLeft) <= LAYOUT_SIZE_EPSILON &&
      Math.abs(right - nextRight) <= LAYOUT_SIZE_EPSILON
    ) {
      return node;
    }

    changed = true;
    return {
      ...node,
      sizes,
    };
  });

  if (!changed) {
    return state;
  }

  return {
    ...state,
    root: nextRoot,
  };
}

export function toggleLeafCollapse(
  state: WorkspaceState,
  leafId: string,
): WorkspaceState {
  if (!state.root) {
    return state;
  }

  return {
    ...state,
    root: updateParentSplit(state.root, leafId, (split, index) => {
      const nextLeaf = split.children[index];
      if (nextLeaf.type !== "leaf") {
        return split;
      }

      const wasCollapsed = nextLeaf.collapsed;
      const expandedSizes = split.lastExpandedSizes ?? split.sizes;
      const sizes: [number, number] = wasCollapsed
        ? expandedSizes
        : index === 0
          ? [12, 88]
          : [88, 12];

      const nextChildren = [...split.children] as [WorkspaceNode, WorkspaceNode];
      nextChildren[index] = {
        ...nextLeaf,
        collapsed: !wasCollapsed,
      };

      return {
        ...split,
        sizes,
        revision: split.revision + 1,
        lastExpandedSizes: wasCollapsed ? split.lastExpandedSizes : split.sizes,
        children: nextChildren,
      };
    }),
  };
}

export function swapWithSibling(
  state: WorkspaceState,
  leafId: string,
): WorkspaceState {
  if (!state.root) {
    return state;
  }

  return {
    ...state,
    root: updateParentSplit(state.root, leafId, (split) => ({
      ...split,
      revision: split.revision + 1,
      sizes: [split.sizes[1], split.sizes[0]],
      children: [split.children[1], split.children[0]],
    })),
  };
}

export function toggleParentOrientation(
  state: WorkspaceState,
  leafId: string,
): WorkspaceState {
  if (!state.root) {
    return state;
  }

  return {
    ...state,
    root: updateParentSplit(state.root, leafId, (split) => ({
      ...split,
      orientation: split.orientation === "horizontal" ? "vertical" : "horizontal",
      revision: split.revision + 1,
    })),
  };
}

export function getLeafThreadMap(node: WorkspaceNode | null): Record<string, string> {
  if (!node) {
    return {};
  }

  if (node.type === "leaf") {
    return { [node.id]: node.threadId };
  }

  return {
    ...getLeafThreadMap(node.children[0]),
    ...getLeafThreadMap(node.children[1]),
  };
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) {
      return createInitialWorkspace();
    }
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return createInitialWorkspace();
  }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(state));
}
