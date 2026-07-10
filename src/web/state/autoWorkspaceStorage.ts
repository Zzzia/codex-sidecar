import {
  DEFAULT_MAX_MAIN_PANES,
  normalizeAutoWorkspaceState,
  normalizeMaxMainPanes,
  type AutoWorkspaceState,
} from "./autoWorkspace.js";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTO_WORKSPACE_STORAGE_KEY = "codex-app.auto-workspace.v1";
export const MAX_MAIN_PANES_STORAGE_KEY =
  "codex-app.auto-workspace.max-panes.v1";

const LEGACY_WORKSPACE_STORAGE_KEY = "codex-app.workspace.v1";

function browserStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadMaxMainPanes(storage = browserStorage()): number {
  if (!storage) {
    return DEFAULT_MAX_MAIN_PANES;
  }
  const raw = storage.getItem(MAX_MAIN_PANES_STORAGE_KEY);
  return normalizeMaxMainPanes(Number(raw));
}

export function saveMaxMainPanes(value: number, storage = browserStorage()): void {
  storage?.setItem(MAX_MAIN_PANES_STORAGE_KEY, String(normalizeMaxMainPanes(value)));
}

export function loadAutoWorkspaceState(
  storage = browserStorage(),
): AutoWorkspaceState {
  if (!storage) {
    return normalizeAutoWorkspaceState({});
  }
  try {
    const raw = storage.getItem(AUTO_WORKSPACE_STORAGE_KEY);
    return raw
      ? normalizeAutoWorkspaceState(JSON.parse(raw) as Partial<AutoWorkspaceState>)
      : normalizeAutoWorkspaceState({});
  } catch {
    return normalizeAutoWorkspaceState({});
  }
}

export function saveAutoWorkspaceState(
  state: AutoWorkspaceState,
  storage = browserStorage(),
): void {
  storage?.setItem(
    AUTO_WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      visiblePaneThreadIds: state.visiblePaneThreadIds,
      pinnedThreadIds: state.pinnedThreadIds,
      tray: state.tray,
      threadObservationInitialized: state.threadObservationInitialized,
      observedThreadUpdatedAtById: state.observedThreadUpdatedAtById,
    }),
  );
}

export function clearLegacyWorkspaceState(storage = browserStorage()): void {
  storage?.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
}
