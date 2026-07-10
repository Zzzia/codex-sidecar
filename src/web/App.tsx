import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreadSummary } from "@shared/types";
import { ProjectSidebar } from "@web/components/ProjectSidebar";
import { TaskTray } from "@web/components/TaskTray";
import { WorkspaceView } from "@web/components/WorkspaceView";
import { useProjects } from "@web/hooks/useProjects";
import {
  archiveAutoWorkspaceThread,
  clearAutoWorkspaceNotice,
  closeAutoWorkspaceMainThread,
  closeAutoWorkspacePreview,
  createInitialAutoWorkspaceState,
  openAutoWorkspacePreview,
  pinAutoWorkspaceThreadToMain,
  setAutoWorkspaceMaxMainPanes,
  syncAutoWorkspaceThreads,
  unpinAutoWorkspaceThread,
  type AutoWorkspaceState,
} from "@web/state/autoWorkspace";
import {
  clearLegacyWorkspaceState,
  loadAutoWorkspaceState,
  loadMaxMainPanes,
  saveAutoWorkspaceState,
  saveMaxMainPanes,
} from "@web/state/autoWorkspaceStorage";
import {
  createInitialWorkspace,
  type WorkspaceState,
} from "@web/state/workspace";
import { reconcileWorkspaceToThreads } from "@web/state/workspaceReconcile";

const SIDEBAR_OPEN_KEY = "codex-app.sidebar-pinned.v2";
const RECENT_THREADS_POLL_INTERVAL_MS = 3000;
const PROJECT_SIDEBAR_ENABLED = false;
const KEYBOARD_EVENT_TYPES = ["keydown", "keypress", "keyup"] as const;

function loadSidebarOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
    return raw ? raw === "true" : false;
  } catch {
    return true;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function isCopyShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "c"
  );
}

function blockNonCopyKeyboardInput(event: KeyboardEvent) {
  if (isCopyShortcut(event)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
}

export default function App() {
  const projects = useProjects();
  const [autoWorkspace, setAutoWorkspace] = useState<AutoWorkspaceState>(() =>
    typeof window === "undefined"
      ? createInitialAutoWorkspaceState()
      : loadAutoWorkspaceState(),
  );
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    createInitialWorkspace(),
  );
  const [threadSummaries, setThreadSummaries] = useState<
    Map<string, ThreadSummary>
  >(() => new Map());
  const [maxMainPanes, setMaxMainPanesState] = useState(() =>
    typeof window === "undefined" ? 3 : loadMaxMainPanes(),
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window === "undefined" ? true : loadSidebarOpen(),
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const threadSummariesRef = useRef(threadSummaries);
  const maxMainPanesRef = useRef(maxMainPanes);

  useEffect(() => {
    const listenerOptions = { capture: true };
    for (const eventType of KEYBOARD_EVENT_TYPES) {
      window.addEventListener(eventType, blockNonCopyKeyboardInput, listenerOptions);
    }
    return () => {
      for (const eventType of KEYBOARD_EVENT_TYPES) {
        window.removeEventListener(
          eventType,
          blockNonCopyKeyboardInput,
          listenerOptions,
        );
      }
    };
  }, []);

  useEffect(() => {
    clearLegacyWorkspaceState();
  }, []);

  useEffect(() => {
    saveAutoWorkspaceState(autoWorkspace);
  }, [autoWorkspace]);

  useEffect(() => {
    maxMainPanesRef.current = maxMainPanes;
    saveMaxMainPanes(maxMainPanes);
  }, [maxMainPanes]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  const visiblePaneKey = autoWorkspace.visiblePaneThreadIds.join("\u0000");
  useEffect(() => {
    setWorkspace((current) =>
      reconcileWorkspaceToThreads(current, autoWorkspace.visiblePaneThreadIds),
    );
  }, [visiblePaneKey]);

  const rememberThreadSummaries = (
    summaries: readonly ThreadSummary[],
  ): ThreadSummary[] => {
    if (summaries.length === 0) {
      return [...threadSummariesRef.current.values()];
    }

    const next = new Map(threadSummariesRef.current);
    for (const summary of summaries) {
      next.set(summary.id, summary);
    }
    threadSummariesRef.current = next;
    setThreadSummaries(next);
    return [...next.values()];
  };

  const syncThreadSummaries = (summaries: readonly ThreadSummary[]) => {
    rememberThreadSummaries(summaries);
    setAutoWorkspace((current) =>
      syncAutoWorkspaceThreads(
        current,
        summaries,
        maxMainPanesRef.current,
      ),
    );
  };

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;

    const refreshRecentThreads = async () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      try {
        const data = await fetchJson<{ items: ThreadSummary[] }>(
          "/api/threads/recent",
        );
        if (cancelled) {
          return;
        }
        syncThreadSummaries(data.items);
        setSyncError(null);
      } catch (error) {
        if (!cancelled) {
          setSyncError(
            error instanceof Error ? error.message : "Failed to sync recent sessions",
          );
        }
      } finally {
        refreshing = false;
      }
    };

    void refreshRecentThreads();
    const timer = window.setInterval(
      refreshRecentThreads,
      RECENT_THREADS_POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const allKnownSummaries = useMemo(
    () => [...threadSummaries.values()],
    [threadSummaries],
  );

  const onWorkspaceChange = (updater: (state: WorkspaceState) => WorkspaceState) => {
    setWorkspace((current) => updater(current));
  };

  const pinThreadToMain = (
    threadId: string,
    summary?: ThreadSummary,
  ) => {
    const summaries = summary
      ? rememberThreadSummaries([summary])
      : [...threadSummariesRef.current.values()];
    setAutoWorkspace((current) =>
      pinAutoWorkspaceThreadToMain(
        current,
        threadId,
        summaries,
        maxMainPanesRef.current,
      ),
    );
  };

  const updateMaxMainPanes = (value: number) => {
    setMaxMainPanesState(value);
    setAutoWorkspace((current) =>
      setAutoWorkspaceMaxMainPanes(
        current,
        [...threadSummariesRef.current.values()],
        value,
      ),
    );
  };

  const toggleThreadPin = (threadId: string) => {
    setAutoWorkspace((current) =>
      current.pinnedThreadIds.includes(threadId)
        ? unpinAutoWorkspaceThread(
            current,
            threadId,
            [...threadSummariesRef.current.values()],
            maxMainPanesRef.current,
          )
        : pinAutoWorkspaceThreadToMain(
            current,
            threadId,
            [...threadSummariesRef.current.values()],
            maxMainPanesRef.current,
          ),
    );
  };

  return (
    <main
      className={`app-shell ${
        PROJECT_SIDEBAR_ENABLED ? "" : "is-sidebar-hidden"
      }`}
    >
      {PROJECT_SIDEBAR_ENABLED ? (
        <ProjectSidebar
          projects={projects.items}
          loading={projects.loading}
          error={projects.error}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((current) => !current)}
          onOpenThread={(thread) => pinThreadToMain(thread.id, thread)}
          onLoadMore={projects.loadMore}
        />
      ) : null}
      <WorkspaceView
        state={workspace}
        onChange={onWorkspaceChange}
        pinnedThreadIds={autoWorkspace.pinnedThreadIds}
        onCloseThread={(threadId) =>
          setAutoWorkspace((current) =>
            closeAutoWorkspaceMainThread(current, threadId, allKnownSummaries),
          )
        }
        onToggleThreadPin={toggleThreadPin}
      />
      <TaskTray
        state={autoWorkspace}
        summaries={threadSummaries}
        maxMainPanes={maxMainPanes}
        syncError={syncError}
        onMaxMainPanesChange={updateMaxMainPanes}
        onOpenPreview={(threadId) =>
          setAutoWorkspace((current) => openAutoWorkspacePreview(current, threadId))
        }
        onClosePreview={() =>
          setAutoWorkspace((current) =>
            closeAutoWorkspacePreview(current, allKnownSummaries),
          )
        }
        onArchiveThread={(threadId) =>
          setAutoWorkspace((current) =>
            archiveAutoWorkspaceThread(current, threadId, allKnownSummaries),
          )
        }
        onPinToMain={(threadId) => pinThreadToMain(threadId)}
        onDismissNotice={() =>
          setAutoWorkspace((current) => clearAutoWorkspaceNotice(current))
        }
      />
    </main>
  );
}
