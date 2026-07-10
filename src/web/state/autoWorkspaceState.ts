import {
  createEmptyAutoWorkspaceTray,
  finalizeAutoWorkspaceState,
  MAX_ARCHIVED_THREADS,
  normalizeObservedThreadUpdates,
  unique,
  type AutoWorkspaceState,
} from "./autoWorkspaceModel.js";

export function createInitialAutoWorkspaceState(): AutoWorkspaceState {
  return {
    visiblePaneThreadIds: [],
    pinnedThreadIds: [],
    tray: createEmptyAutoWorkspaceTray(),
    threadObservationInitialized: false,
    observedThreadUpdatedAtById: {},
    previewThreadId: null,
    notice: null,
  };
}

export function normalizeAutoWorkspaceState(
  parsed: Partial<AutoWorkspaceState>,
): AutoWorkspaceState {
  return finalizeAutoWorkspaceState(
    {
      visiblePaneThreadIds: unique(parsed.visiblePaneThreadIds ?? []),
      pinnedThreadIds: unique(parsed.pinnedThreadIds ?? []),
      tray: {
        pendingReview: unique(parsed.tray?.pendingReview ?? []),
        running: unique(parsed.tray?.running ?? []),
        archived: unique(parsed.tray?.archived ?? []).slice(0, MAX_ARCHIVED_THREADS),
      },
      threadObservationInitialized: parsed.threadObservationInitialized === true,
      observedThreadUpdatedAtById: normalizeObservedThreadUpdates(
        parsed.observedThreadUpdatedAtById,
      ),
      previewThreadId: null,
      notice: null,
    },
    new Map(),
  );
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
