import { useEffect, useState } from "react";
import { ProjectSidebar } from "@web/components/ProjectSidebar";
import { WorkspaceView } from "@web/components/WorkspaceView";
import { useProjects } from "@web/hooks/useProjects";
import {
  createInitialWorkspace,
  loadWorkspaceState,
  openThreadInWorkspace,
  saveWorkspaceState,
  type WorkspaceState,
} from "@web/state/workspace";

const SIDEBAR_OPEN_KEY = "codex-app.sidebar-pinned.v2";

function loadSidebarOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
    return raw ? raw === "true" : false;
  } catch {
    return true;
  }
}

export default function App() {
  const projects = useProjects();
  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    typeof window === "undefined" ? createInitialWorkspace() : loadWorkspaceState(),
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window === "undefined" ? true : loadSidebarOpen(),
  );

  useEffect(() => {
    saveWorkspaceState(workspace);
  }, [workspace]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  const onWorkspaceChange = (updater: (state: WorkspaceState) => WorkspaceState) => {
    setWorkspace((current) => updater(current));
  };

  return (
    <main className="app-shell">
      <ProjectSidebar
        projects={projects.items}
        loading={projects.loading}
        error={projects.error}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onOpenThread={(threadId) =>
          setWorkspace((current) => openThreadInWorkspace(current, threadId))
        }
        onLoadMore={projects.loadMore}
      />
      <WorkspaceView
        state={workspace}
        onChange={onWorkspaceChange}
      />
    </main>
  );
}
