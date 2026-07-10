import type { ThreadStatus, ThreadSummary } from "@shared/types";

export const DEFAULT_MAX_MAIN_PANES = 3;
export const MAX_MAIN_PANE_OPTIONS = [2, 3, 4, 5, 6] as const;
export const MAX_ARCHIVED_THREADS = 50;
export const MAX_OBSERVED_THREADS = 300;

export interface AutoWorkspaceTrayState {
  pendingReview: string[];
  running: string[];
  archived: string[];
}

export interface AutoWorkspaceState {
  visiblePaneThreadIds: string[];
  pinnedThreadIds: string[];
  tray: AutoWorkspaceTrayState;
  /** Avoids treating every historical completed thread as new work after upgrade. */
  threadObservationInitialized: boolean;
  /** Latest SQLite update timestamp seen for each recent or workspace-owned thread. */
  observedThreadUpdatedAtById: Record<string, number>;
  previewThreadId: string | null;
  notice: string | null;
}

export type TrayBucket = keyof AutoWorkspaceTrayState;
export type ThreadLookup = ReadonlyMap<string, ThreadSummary>;

export function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function removeId(ids: readonly string[], threadId: string): string[] {
  return ids.filter((id) => id !== threadId);
}

export function withoutIds(
  ids: readonly string[],
  blocked: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => !blocked.has(id));
}

export function orderVisiblePaneThreadIds(
  visibleThreadIds: readonly string[],
  pinnedThreadIds: readonly string[],
): string[] {
  const visibleSet = new Set(visibleThreadIds);
  const pinnedVisible = unique(pinnedThreadIds).filter((threadId) =>
    visibleSet.has(threadId),
  );
  const pinnedSet = new Set(pinnedVisible);
  return [
    ...pinnedVisible,
    ...visibleThreadIds.filter((threadId) => !pinnedSet.has(threadId)),
  ];
}

export function threadStatus(
  lookup: ThreadLookup,
  threadId: string,
): ThreadStatus | null {
  return lookup.get(threadId)?.status ?? null;
}

function updatedAt(lookup: ThreadLookup, threadId: string): number {
  return lookup.get(threadId)?.updatedAt ?? 0;
}

export function sortRecent(
  ids: readonly string[],
  lookup: ThreadLookup,
): string[] {
  return unique(ids).sort((left, right) => {
    const delta = updatedAt(lookup, right) - updatedAt(lookup, left);
    return delta === 0 ? left.localeCompare(right) : delta;
  });
}

export function sortOldest(
  ids: readonly string[],
  lookup: ThreadLookup,
): string[] {
  return unique(ids).sort((left, right) => {
    const delta = updatedAt(lookup, left) - updatedAt(lookup, right);
    return delta === 0 ? left.localeCompare(right) : delta;
  });
}

export function makeLookup(summaries: readonly ThreadSummary[]): ThreadLookup {
  return new Map(summaries.map((summary) => [summary.id, summary]));
}

export function createEmptyAutoWorkspaceTray(): AutoWorkspaceTrayState {
  return {
    pendingReview: [],
    running: [],
    archived: [],
  };
}

export function finalizeAutoWorkspaceState(
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

export function normalizeObservedThreadUpdates(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([threadId, updatedAt]) =>
          Boolean(threadId) &&
          typeof updatedAt === "number" &&
          Number.isFinite(updatedAt) &&
          updatedAt >= 0,
      )
      .slice(0, MAX_OBSERVED_THREADS),
  );
}
