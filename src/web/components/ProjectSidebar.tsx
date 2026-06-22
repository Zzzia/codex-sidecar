import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  FolderGit2,
  MoreVertical,
  Search,
} from "lucide-react";
import type { ProjectSummary, ThreadSummary } from "@shared/types";
import { formatThreadTitle } from "@web/lib/threadTitle";
import "./ProjectSidebar.css";
import "./ProjectSidebarControls.css";

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function threadLabel(thread: ThreadSummary): string {
  return formatThreadTitle(thread.title, thread.displayName);
}

interface ProjectSidebarProps {
  projects: Array<ProjectSummary & { loadedThreads: ThreadSummary[]; nextCursor: string | null }>;
  loading: boolean;
  error: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenThread: (thread: ThreadSummary) => void;
  onLoadMore: (cwd: string) => Promise<void>;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeProjectsOnly, setActiveProjectsOnly] = useState(false);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [loadingAllCwd, setLoadingAllCwd] = useState<string | null>(null);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const sidebarExpanded = props.sidebarOpen || hoverExpanded;

  useEffect(() => {
    if (!copiedKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopiedKey(null);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copiedKey]);

  const copyText = async (key: string, value: string) => {
    try {
      if (!navigator.clipboard) {
        return;
      }
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
    } catch {
      setCopiedKey(null);
    }
  };

  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  const filteredProjects = props.projects.filter((project) => {
    if (activeProjectsOnly && project.activeThreadCount === 0) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const projectText = `${project.displayName} ${project.cwd}`.toLowerCase();
    if (projectText.includes(normalizedQuery)) {
      return true;
    }

    return project.loadedThreads.some((thread) =>
      `${threadLabel(thread)} ${thread.cwd}`.toLowerCase().includes(normalizedQuery),
    );
  });
  const effectiveSelectedCwd = filteredProjects.some(
    (project) => project.cwd === selectedCwd,
  )
    ? selectedCwd
    : filteredProjects[0]?.cwd ?? null;
  const selectedProject =
    filteredProjects.find((project) => project.cwd === effectiveSelectedCwd) ?? null;
  const selectedThreads = selectedProject
    ? selectedProject.loadedThreads.filter((thread) => {
        if (!normalizedQuery) {
          return true;
        }
        return `${threadLabel(thread)} ${thread.cwd}`
          .toLowerCase()
          .includes(normalizedQuery);
      })
    : [];
  const selectedProjectHasMore = selectedProject
    ? selectedProject.nextCursor != null ||
      selectedProject.loadedThreads.length < selectedProject.totalThreadCount
    : false;

  const loadAllSelectedThreads = async () => {
    if (!selectedProject || loadingAllCwd) {
      return;
    }

    try {
      setLoadingAllCwd(selectedProject.cwd);
      await props.onLoadMore(selectedProject.cwd);
    } finally {
      setLoadingAllCwd(null);
    }
  };

  const closeTransientSidebar = () => {
    if (!props.sidebarOpen) {
      setHoverExpanded(false);
    }
  };

  return (
    <aside
      className={`project-sidebar ${sidebarExpanded ? "is-open" : "is-closed"} ${
        props.sidebarOpen ? "is-pinned" : "is-transient"
      }`}
      onMouseEnter={() => setHoverExpanded(true)}
      onMouseLeave={closeTransientSidebar}
    >
      {sidebarExpanded ? (
        <div className="sidebar-header">
          <div className="sidebar-app-title">
            <h1 title="codex-sidecar">codex-sidecar</h1>
          </div>
          <button
            className="icon-button"
            onClick={props.onToggleSidebar}
            title={props.sidebarOpen ? "Hide sidebar" : "Pin sidebar"}
          >
            {props.sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="sidebar-collapsed-trigger"
          onClick={props.onToggleSidebar}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <ChevronRight size={15} />
        </button>
      )}

      {sidebarExpanded ? (
        <>
          {props.loading ? <div className="sidebar-empty">Loading projects...</div> : null}
          {props.error ? <div className="sidebar-error">{props.error}</div> : null}
          <div className="sidebar-search-row">
            <label className="sidebar-search-box">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects / sessions"
              />
            </label>
            <button
              className={`sidebar-filter-button ${
                activeProjectsOnly ? "is-active" : ""
              }`}
              onClick={() => setActiveProjectsOnly((current) => !current)}
              title={activeProjectsOnly ? "Show all projects" : "Active projects only"}
              aria-label={activeProjectsOnly ? "Show all projects" : "Active projects only"}
            >
              <Activity size={14} />
            </button>
          </div>
          <div className="sidebar-content">
            <section className="project-section" aria-label="Projects">
              <div className="sidebar-section-title">Projects</div>
              <div className="project-list">
                {filteredProjects.length === 0 ? (
                  <div className="sidebar-empty inline">No matching projects</div>
                ) : (
                  filteredProjects.map((project) => (
                    <div
                      key={project.cwd}
                      className={`project-card ${
                        project.cwd === effectiveSelectedCwd ? "is-selected" : ""
                      }`}
                      onClick={() => setSelectedCwd(project.cwd)}
                      title={`${project.displayName}\n${project.cwd}`}
                    >
                      <div className="project-card-header">
                        <div className="project-title-wrap">
                          <FolderGit2 size={16} />
                          <div className="project-title-main">
                            <strong title={project.displayName}>
                              {project.displayName}
                            </strong>
                            <div className="project-path-row">
                              <p title={project.cwd}>{project.cwd}</p>
                              <span
                                className={`sidebar-copy-button ${
                                  copiedKey === `project:${project.cwd}` ? "is-copied" : ""
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void copyText(`project:${project.cwd}`, project.cwd);
                                }}
                                title={
                                  copiedKey === `project:${project.cwd}`
                                    ? "Project path copied"
                                    : "Copy project path"
                                }
                                aria-label="Copy project path"
                              >
                                {copiedKey === `project:${project.cwd}` ? (
                                  <Check size={12} />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="project-stats">
                        <span>{project.activeThreadCount} active</span>
                        <span>{project.totalThreadCount} sessions</span>
                        <span className="project-updated">
                          <Clock3 size={12} />
                          {timeLabel(project.latestUpdatedAt)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="thread-section" aria-label="Sessions">
              <div className="sidebar-section-title">
                <span>Sessions</span>
                <div className="thread-section-tools">
                  {selectedProject ? (
                    <span title={selectedProject.displayName}>
                      {selectedProject.displayName}
                    </span>
                  ) : null}
                  <button
                    className="thread-section-menu"
                    title="Session sorting and more actions"
                    aria-label="Session sorting and more actions"
                  >
                    <MoreVertical size={13} />
                  </button>
                </div>
              </div>
              <div className="thread-list">
                {!selectedProject ? (
                  <div className="thread-empty">Select a project</div>
                ) : selectedThreads.length === 0 ? (
                  <div className="thread-empty">No sessions match the current filter</div>
                ) : (
                  selectedThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className={`thread-row ${
                        thread.status === "running" ? "is-live" : ""
                      }`}
                      onClick={() => props.onOpenThread(thread)}
                      title={`${threadLabel(thread)}\n${thread.cwd}`}
                    >
                      <div className={`status-dot status-${thread.status}`} />
                      <div className="thread-copy">
                        <div className="thread-title-row">
                          <span
                            className="thread-title-text"
                            title={threadLabel(thread)}
                          >
                            {threadLabel(thread)}
                          </span>
                          <span
                            className={`sidebar-copy-button ${
                              copiedKey === `thread:${thread.id}` ? "is-copied" : ""
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyText(`thread:${thread.id}`, threadLabel(thread));
                            }}
                            title={
                              copiedKey === `thread:${thread.id}`
                                ? "Session title copied"
                                : "Copy session title"
                            }
                            aria-label="Copy session title"
                          >
                            {copiedKey === `thread:${thread.id}` ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                          </span>
                        </div>
                      </div>
                      {thread.status === "running" ? (
                        <span className="thread-live">LIVE</span>
                      ) : (
                        <time title={new Date(thread.updatedAt).toLocaleString("zh-CN")}>
                          {timeLabel(thread.updatedAt)}
                        </time>
                      )}
                    </div>
                  ))
                )}
              </div>
              {selectedProjectHasMore ? (
                <button
                  className="load-more-button"
                  disabled={loadingAllCwd === selectedProject?.cwd}
                  onClick={() => {
                    void loadAllSelectedThreads();
                  }}
                >
                  {loadingAllCwd === selectedProject?.cwd
                    ? "Loading all sessions..."
                    : `Show all sessions (${selectedProject?.totalThreadCount ?? 0})`}
                </button>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </aside>
  );
}
