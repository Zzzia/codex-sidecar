import type { ThreadStatus, ThreadSummary } from "@shared/types";
import {
  createEmptyAutoWorkspaceTray,
  DEFAULT_MAX_MAIN_PANES,
  makeLookup,
  MAX_ARCHIVED_THREADS,
  MAX_MAIN_PANE_OPTIONS,
  orderVisiblePaneThreadIds,
  removeId,
  sortOldest,
  sortRecent,
  threadStatus,
  unique,
  withoutIds,
  type AutoWorkspaceState,
  type AutoWorkspaceTrayState,
  type ThreadLookup,
  type TrayBucket,
} from "./autoWorkspaceModel.js";

export {
  DEFAULT_MAX_MAIN_PANES,
  MAX_ARCHIVED_THREADS,
  MAX_MAIN_PANE_OPTIONS,
  type AutoWorkspaceState,
  type AutoWorkspaceTrayState,
} from "./autoWorkspaceModel.js";

export function createInitialAutoWorkspaceState(): AutoWorkspaceState {
  return {
    visiblePaneThreadIds: [],
    pinnedThreadIds: [],
    tray: createEmptyAutoWorkspaceTray(),
    previewThreadId: null,
    notice: null,
  };
}

export function normalizeAutoWorkspaceState(
  parsed: Partial<AutoWorkspaceState>,
): AutoWorkspaceState {
  return finalizeState(
    {
      visiblePaneThreadIds: unique(parsed.visiblePaneThreadIds ?? []),
      pinnedThreadIds: unique(parsed.pinnedThreadIds ?? []),
      tray: {
        pendingReview: unique(parsed.tray?.pendingReview ?? []),
        running: unique(parsed.tray?.running ?? []),
        archived: unique(parsed.tray?.archived ?? []).slice(0, MAX_ARCHIVED_THREADS),
      },
      previewThreadId: null,
      notice: null,
    },
    new Map(),
  );
}

function addToBucket(
  tray: AutoWorkspaceTrayState,
  bucket: TrayBucket,
  threadId: string,
  lookup: ThreadLookup,
): AutoWorkspaceTrayState {
  return {
    ...tray,
    [bucket]: sortRecent([threadId, ...tray[bucket]], lookup),
  };
}

function removeFromTray(
  tray: AutoWorkspaceTrayState,
  threadId: string,
): AutoWorkspaceTrayState {
  return {
    pendingReview: removeId(tray.pendingReview, threadId),
    running: removeId(tray.running, threadId),
    archived: removeId(tray.archived, threadId),
  };
}

function bucketForThread(
  lookup: ThreadLookup,
  threadId: string,
): TrayBucket {
  return threadStatus(lookup, threadId) === "running" ? "running" : "pendingReview";
}

function moveVisibleThreadToTray(
  state: AutoWorkspaceState,
  threadId: string,
  lookup: ThreadLookup,
): AutoWorkspaceState {
  const bucket = bucketForThread(lookup, threadId);
  return {
    ...state,
    visiblePaneThreadIds: removeId(state.visiblePaneThreadIds, threadId),
    pinnedThreadIds: removeId(state.pinnedThreadIds, threadId),
    tray: addToBucket(removeFromTray(state.tray, threadId), bucket, threadId, lookup),
  };
}

function findOldestUnpinnedVisible(
  state: AutoWorkspaceState,
  lookup: ThreadLookup,
  statusFilter?: (status: ThreadStatus | null) => boolean,
): string | null {
  const pinned = new Set(state.pinnedThreadIds);
  const candidates = state.visiblePaneThreadIds.filter((threadId) => {
    if (pinned.has(threadId)) {
      return false;
    }
    return statusFilter ? statusFilter(threadStatus(lookup, threadId)) : true;
  });

  return sortOldest(candidates, lookup)[0] ?? null;
}

function trimToMainPaneLimit(
  state: AutoWorkspaceState,
  lookup: ThreadLookup,
  maxMainPanes: number,
): AutoWorkspaceState {
  let next = state;
  while (next.visiblePaneThreadIds.length > maxMainPanes) {
    const evicted = findOldestUnpinnedVisible(next, lookup);
    if (!evicted) {
      break;
    }
    next = moveVisibleThreadToTray(next, evicted, lookup);
  }
  return next;
}

function fillMainPanesFromRunningTray(
  state: AutoWorkspaceState,
  lookup: ThreadLookup,
  maxMainPanes: number,
): AutoWorkspaceState {
  let next = state;
  for (const threadId of sortRecent(next.tray.running, lookup)) {
    if (next.visiblePaneThreadIds.length >= maxMainPanes) {
      break;
    }
    next = {
      ...next,
      visiblePaneThreadIds: unique([...next.visiblePaneThreadIds, threadId]),
      tray: removeFromTray(next.tray, threadId),
    };
  }
  return next;
}

function placeNewRunningThread(
  state: AutoWorkspaceState,
  threadId: string,
  lookup: ThreadLookup,
  maxMainPanes: number,
): AutoWorkspaceState {
  if (state.visiblePaneThreadIds.includes(threadId)) {
    return state;
  }

  let next = state;
  if (next.visiblePaneThreadIds.length >= maxMainPanes) {
    const finishedAutoPane = findOldestUnpinnedVisible(
      next,
      lookup,
      (status) => status !== "running",
    );
    if (finishedAutoPane) {
      next = moveVisibleThreadToTray(next, finishedAutoPane, lookup);
    }
  }

  if (next.visiblePaneThreadIds.length < maxMainPanes) {
    return {
      ...next,
      visiblePaneThreadIds: unique([...next.visiblePaneThreadIds, threadId]),
      tray: removeFromTray(next.tray, threadId),
    };
  }

  return {
    ...next,
    tray: addToBucket(removeFromTray(next.tray, threadId), "running", threadId, lookup),
  };
}

function finalizeState(
  state: AutoWorkspaceState,
  lookup: ThreadLookup,
): AutoWorkspaceState {
  const rawVisible = unique(state.visiblePaneThreadIds);
  const rawVisibleSet = new Set(rawVisible);
  const pinnedThreadIds = unique(state.pinnedThreadIds).filter((threadId) =>
    rawVisibleSet.has(threadId),
  );
  const visible = orderVisiblePaneThreadIds(rawVisible, pinnedThreadIds);
  const visibleSet = new Set(visible);
  const running = sortRecent(withoutIds(state.tray.running, visibleSet), lookup);
  const runningSet = new Set(running);
  const pendingReview = sortRecent(
    withoutIds(state.tray.pendingReview, new Set([...visibleSet, ...runningSet])),
    lookup,
  );
  const blocked = new Set([...visibleSet, ...runningSet, ...pendingReview]);
  const archived = sortRecent(withoutIds(state.tray.archived, blocked), lookup).slice(
    0,
    MAX_ARCHIVED_THREADS,
  );

  return {
    ...state,
    visiblePaneThreadIds: visible,
    pinnedThreadIds,
    tray: {
      pendingReview,
      running,
      archived,
    },
    previewThreadId: state.previewThreadId,
  };
}

export function getAutoWorkspaceKnownThreadIds(
  state: AutoWorkspaceState,
): string[] {
  return unique([
    ...state.visiblePaneThreadIds,
    ...state.pinnedThreadIds,
    ...state.tray.pendingReview,
    ...state.tray.running,
    ...state.tray.archived,
    ...(state.previewThreadId ? [state.previewThreadId] : []),
  ]).slice(0, 100);
}

export function syncAutoWorkspaceThreads(
  state: AutoWorkspaceState,
  summaries: readonly ThreadSummary[],
  maxMainPanes: number,
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  let next = finalizeState({ ...state, notice: null }, lookup);
  const knownBefore = new Set(getAutoWorkspaceKnownThreadIds(state));
  const newRunningThreadIds: string[] = [];

  for (const summary of summaries) {
    const isVisible = next.visiblePaneThreadIds.includes(summary.id);
    const wasRunningTray = next.tray.running.includes(summary.id);

    if (summary.status === "running") {
      next = {
        ...next,
        tray: removeFromTray(next.tray, summary.id),
      };
      if (!isVisible && !knownBefore.has(summary.id)) {
        newRunningThreadIds.push(summary.id);
      }
      continue;
    }

    next = {
      ...next,
      tray: {
        ...next.tray,
        running: removeId(next.tray.running, summary.id),
      },
    };
    if (wasRunningTray && !isVisible) {
      next = {
        ...next,
        tray: addToBucket(next.tray, "pendingReview", summary.id, lookup),
      };
    }
  }

  next = trimToMainPaneLimit(next, lookup, maxMainPanes);
  for (const threadId of sortRecent(newRunningThreadIds, lookup)) {
    next = placeNewRunningThread(next, threadId, lookup, maxMainPanes);
  }

  return finalizeState(next, lookup);
}

export function setAutoWorkspaceMaxMainPanes(
  state: AutoWorkspaceState,
  summaries: readonly ThreadSummary[],
  maxMainPanes: number,
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  const trimmed = trimToMainPaneLimit({ ...state, notice: null }, lookup, maxMainPanes);
  return finalizeState(
    fillMainPanesFromRunningTray(trimmed, lookup, maxMainPanes),
    lookup,
  );
}

export function pinAutoWorkspaceThreadToMain(
  state: AutoWorkspaceState,
  threadId: string,
  summaries: readonly ThreadSummary[],
  maxMainPanes: number,
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  let next = finalizeState({ ...state, notice: null }, lookup);

  if (next.visiblePaneThreadIds.includes(threadId)) {
    return finalizeState(
      {
        ...next,
        pinnedThreadIds: unique([...next.pinnedThreadIds, threadId]),
        tray: removeFromTray(next.tray, threadId),
        previewThreadId: null,
      },
      lookup,
    );
  }

  if (next.visiblePaneThreadIds.length >= maxMainPanes) {
    const evicted = findOldestUnpinnedVisible(next, lookup);
    if (!evicted) {
      const pinnedCount = next.pinnedThreadIds.length;
      return {
        ...next,
        notice: `主面板已固定 ${pinnedCount} 个，请先关闭或取消固定一个会话`,
      };
    }
    next = moveVisibleThreadToTray(next, evicted, lookup);
  }

  return finalizeState(
    {
      ...next,
      visiblePaneThreadIds: unique([...next.visiblePaneThreadIds, threadId]),
      pinnedThreadIds: unique([...next.pinnedThreadIds, threadId]),
      tray: removeFromTray(next.tray, threadId),
      previewThreadId: null,
    },
    lookup,
  );
}

export function unpinAutoWorkspaceThread(
  state: AutoWorkspaceState,
  threadId: string,
  summaries: readonly ThreadSummary[],
  maxMainPanes: number,
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  const unpinned = {
    ...state,
    pinnedThreadIds: removeId(state.pinnedThreadIds, threadId),
    notice: null,
  };
  return finalizeState(trimToMainPaneLimit(unpinned, lookup, maxMainPanes), lookup);
}

export function closeAutoWorkspaceMainThread(
  state: AutoWorkspaceState,
  threadId: string,
  summaries: readonly ThreadSummary[],
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  const status = threadStatus(lookup, threadId);
  const bucket: TrayBucket = status === "running" ? "running" : "archived";
  return finalizeState(
    {
      ...state,
      visiblePaneThreadIds: removeId(state.visiblePaneThreadIds, threadId),
      pinnedThreadIds: removeId(state.pinnedThreadIds, threadId),
      tray: addToBucket(removeFromTray(state.tray, threadId), bucket, threadId, lookup),
      notice: null,
    },
    lookup,
  );
}

export function openAutoWorkspacePreview(
  state: AutoWorkspaceState,
  threadId: string,
): AutoWorkspaceState {
  return {
    ...state,
    previewThreadId: threadId,
    notice: null,
  };
}

export function closeAutoWorkspacePreview(
  state: AutoWorkspaceState,
  summaries: readonly ThreadSummary[],
): AutoWorkspaceState {
  if (!state.previewThreadId) {
    return state;
  }

  const lookup = makeLookup(summaries);
  const threadId = state.previewThreadId;
  const shouldArchive = state.tray.pendingReview.includes(threadId);
  const tray = shouldArchive
    ? addToBucket(removeFromTray(state.tray, threadId), "archived", threadId, lookup)
    : state.tray;

  return finalizeState(
    {
      ...state,
      tray,
      previewThreadId: null,
      notice: null,
    },
    lookup,
  );
}

export function archiveAutoWorkspaceThread(
  state: AutoWorkspaceState,
  threadId: string,
  summaries: readonly ThreadSummary[],
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  if (threadStatus(lookup, threadId) === "running") {
    return {
      ...state,
      previewThreadId: state.previewThreadId === threadId ? null : state.previewThreadId,
      notice: null,
    };
  }
  return finalizeState(
    {
      ...state,
      tray: addToBucket(removeFromTray(state.tray, threadId), "archived", threadId, lookup),
      previewThreadId: state.previewThreadId === threadId ? null : state.previewThreadId,
      notice: null,
    },
    lookup,
  );
}

export function clearAutoWorkspaceNotice(state: AutoWorkspaceState): AutoWorkspaceState {
  return {
    ...state,
    notice: null,
  };
}

export function normalizeMaxMainPanes(value: number): number {
  return MAX_MAIN_PANE_OPTIONS.includes(
    value as (typeof MAX_MAIN_PANE_OPTIONS)[number],
  )
    ? value
    : DEFAULT_MAX_MAIN_PANES;
}
