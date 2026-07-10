import type { ThreadStatus, ThreadSummary } from "@shared/types";
import {
  DEFAULT_MAX_MAIN_PANES,
  finalizeAutoWorkspaceState,
  makeLookup,
  MAX_ARCHIVED_THREADS,
  MAX_MAIN_PANE_OPTIONS,
  MAX_OBSERVED_THREADS,
  removeId,
  sortOldest,
  sortRecent,
  threadStatus,
  unique,
  type AutoWorkspaceState,
  type AutoWorkspaceTrayState,
  type ThreadLookup,
  type TrayBucket,
} from "./autoWorkspaceModel.js";
import { getAutoWorkspaceKnownThreadIds } from "./autoWorkspaceState.js";

export {
  createInitialAutoWorkspaceState,
  getAutoWorkspaceKnownThreadIds,
  normalizeAutoWorkspaceState,
} from "./autoWorkspaceState.js";

export {
  DEFAULT_MAX_MAIN_PANES,
  MAX_ARCHIVED_THREADS,
  MAX_MAIN_PANE_OPTIONS,
  type AutoWorkspaceState,
  type AutoWorkspaceTrayState,
} from "./autoWorkspaceModel.js";

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

function placeRunningThread(
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

function isReviewReadyStatus(status: ThreadStatus): boolean {
  return status === "completed" || status === "error";
}

function readObservedUpdatedAt(
  state: AutoWorkspaceState,
  threadId: string,
): number | undefined {
  return Object.hasOwn(state.observedThreadUpdatedAtById, threadId)
    ? state.observedThreadUpdatedAtById[threadId]
    : undefined;
}

function reconcileThreadObservation(
  state: AutoWorkspaceState,
  summary: ThreadSummary,
  hasNewActivity: boolean,
  lookup: ThreadLookup,
): { state: AutoWorkspaceState; shouldPlaceRunning: boolean } {
  if (state.visiblePaneThreadIds.includes(summary.id)) {
    return { state, shouldPlaceRunning: false };
  }

  const isInRunningTray = state.tray.running.includes(summary.id);
  if (summary.status === "running") {
    // Running-tray placement records an explicit user/capacity decision.
    if (isInRunningTray) {
      return { state, shouldPlaceRunning: false };
    }
    return {
      state: { ...state, tray: removeFromTray(state.tray, summary.id) },
      shouldPlaceRunning: true,
    };
  }

  if (
    !isReviewReadyStatus(summary.status) ||
    (!isInRunningTray && !hasNewActivity)
  ) {
    return { state, shouldPlaceRunning: false };
  }

  return {
    state: {
      ...state,
      tray: addToBucket(
        removeFromTray(state.tray, summary.id),
        "pendingReview",
        summary.id,
        lookup,
      ),
    },
    shouldPlaceRunning: false,
  };
}

function recordThreadObservations(
  previous: AutoWorkspaceState,
  next: AutoWorkspaceState,
  summaries: readonly ThreadSummary[],
): Record<string, number> {
  const observations = new Map<string, number>();
  for (const summary of summaries) {
    observations.set(summary.id, summary.updatedAt);
  }

  for (const threadId of getAutoWorkspaceKnownThreadIds(next)) {
    const previousUpdatedAt = readObservedUpdatedAt(previous, threadId);
    if (!observations.has(threadId) && previousUpdatedAt !== undefined) {
      observations.set(threadId, previousUpdatedAt);
    }
  }

  return Object.fromEntries([...observations].slice(0, MAX_OBSERVED_THREADS));
}

export function syncAutoWorkspaceThreads(
  state: AutoWorkspaceState,
  summaries: readonly ThreadSummary[],
  maxMainPanes: number,
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  let next = finalizeAutoWorkspaceState({ ...state, notice: null }, lookup);
  const runningThreadIdsToPlace: string[] = [];

  for (const summary of summaries) {
    const previousUpdatedAt = readObservedUpdatedAt(state, summary.id);
    const hasNewActivity =
      state.threadObservationInitialized &&
      previousUpdatedAt !== summary.updatedAt;
    const result = reconcileThreadObservation(
      next,
      summary,
      hasNewActivity,
      lookup,
    );
    next = result.state;
    if (result.shouldPlaceRunning) {
      runningThreadIdsToPlace.push(summary.id);
    }
  }

  next = trimToMainPaneLimit(next, lookup, maxMainPanes);
  for (const threadId of sortRecent(runningThreadIdsToPlace, lookup)) {
    next = placeRunningThread(next, threadId, lookup, maxMainPanes);
  }

  return finalizeAutoWorkspaceState(
    {
      ...next,
      threadObservationInitialized: true,
      observedThreadUpdatedAtById: recordThreadObservations(
        state,
        next,
        summaries,
      ),
    },
    lookup,
  );
}

export function setAutoWorkspaceMaxMainPanes(
  state: AutoWorkspaceState,
  summaries: readonly ThreadSummary[],
  maxMainPanes: number,
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  const trimmed = trimToMainPaneLimit({ ...state, notice: null }, lookup, maxMainPanes);
  return finalizeAutoWorkspaceState(
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
  let next = finalizeAutoWorkspaceState({ ...state, notice: null }, lookup);

  if (next.visiblePaneThreadIds.includes(threadId)) {
    return finalizeAutoWorkspaceState(
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
        notice: `Main area already has ${pinnedCount} pinned sessions. Close or unpin one first.`,
      };
    }
    next = moveVisibleThreadToTray(next, evicted, lookup);
  }

  return finalizeAutoWorkspaceState(
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
  return finalizeAutoWorkspaceState(
    trimToMainPaneLimit(unpinned, lookup, maxMainPanes),
    lookup,
  );
}

export function closeAutoWorkspaceMainThread(
  state: AutoWorkspaceState,
  threadId: string,
  summaries: readonly ThreadSummary[],
): AutoWorkspaceState {
  const lookup = makeLookup(summaries);
  const status = threadStatus(lookup, threadId);
  const bucket: TrayBucket = status === "running" ? "running" : "archived";
  return finalizeAutoWorkspaceState(
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

  return finalizeAutoWorkspaceState(
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
  return finalizeAutoWorkspaceState(
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
