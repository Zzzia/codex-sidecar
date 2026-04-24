import { type FocusEvent, type KeyboardEvent, useEffect, useState } from "react";
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

function runKeyboardAction(event: KeyboardEvent, action: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  action();
}

interface ProjectSidebarProps {
  projects: Array<ProjectSummary & { loadedThreads: ThreadSummary[]; nextCursor: string | null }>;
  loading: boolean;
  error: string | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenThread: (threadId: string) => void;
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

  const onSidebarBlur = (event: FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    closeTransientSidebar();
  };

  return (
    <aside
      className={`project-sidebar ${sidebarExpanded ? "is-open" : "is-closed"} ${
        props.sidebarOpen ? "is-pinned" : "is-transient"
      }`}
      onMouseEnter={() => setHoverExpanded(true)}
      onMouseLeave={closeTransientSidebar}
      onFocus={() => setHoverExpanded(true)}
      onBlur={onSidebarBlur}
    >
      {sidebarExpanded ? (
        <div className="sidebar-header">
          <div className="sidebar-app-title">
            <h1 title="codex-sidecar">codex-sidecar</h1>
          </div>
          <button
            className="icon-button"
            onClick={props.onToggleSidebar}
            title={props.sidebarOpen ? "隐藏侧栏" : "固定侧栏"}
          >
            {props.sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="sidebar-collapsed-trigger"
          onClick={props.onToggleSidebar}
          title="展开侧栏"
          aria-label="展开侧栏"
        >
          <ChevronRight size={15} />
        </button>
      )}

      {sidebarExpanded ? (
        <>
          {props.loading ? <div className="sidebar-empty">工程列表加载中…</div> : null}
          {props.error ? <div className="sidebar-error">{props.error}</div> : null}
          <div className="sidebar-search-row">
            <label className="sidebar-search-box">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目 / 会话"
              />
            </label>
            <button
              className={`sidebar-filter-button ${
                activeProjectsOnly ? "is-active" : ""
              }`}
              onClick={() => setActiveProjectsOnly((current) => !current)}
              title={activeProjectsOnly ? "显示所有项目" : "只看活跃项目"}
              aria-label={activeProjectsOnly ? "显示所有项目" : "只看活跃项目"}
            >
              <Activity size={14} />
            </button>
          </div>
          <div className="sidebar-content">
            <section className="project-section" aria-label="项目">
              <div className="sidebar-section-title">项目</div>
              <div className="project-list">
                {filteredProjects.length === 0 ? (
                  <div className="sidebar-empty inline">没有匹配的项目</div>
                ) : (
                  filteredProjects.map((project) => (
                    <div
                      key={project.cwd}
                      role="button"
                      tabIndex={0}
                      className={`project-card ${
                        project.cwd === effectiveSelectedCwd ? "is-selected" : ""
                      }`}
                      onClick={() => setSelectedCwd(project.cwd)}
                      onKeyDown={(event) =>
                        runKeyboardAction(event, () => setSelectedCwd(project.cwd))
                      }
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
                                role="button"
                                tabIndex={0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void copyText(`project:${project.cwd}`, project.cwd);
                                }}
                                onKeyDown={(event) => {
                                  runKeyboardAction(event, () => {
                                    void copyText(`project:${project.cwd}`, project.cwd);
                                  });
                                }}
                                title={
                                  copiedKey === `project:${project.cwd}`
                                    ? "已复制工程路径"
                                    : "复制工程路径"
                                }
                                aria-label="复制工程路径"
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
                        <span>{project.activeThreadCount} 活跃</span>
                        <span>{project.totalThreadCount} 会话</span>
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

            <section className="thread-section" aria-label="会话">
              <div className="sidebar-section-title">
                <span>会话</span>
                <div className="thread-section-tools">
                  {selectedProject ? (
                    <span title={selectedProject.displayName}>
                      {selectedProject.displayName}
                    </span>
                  ) : null}
                  <button
                    className="thread-section-menu"
                    title="会话排序和更多操作"
                    aria-label="会话排序和更多操作"
                  >
                    <MoreVertical size={13} />
                  </button>
                </div>
              </div>
              <div className="thread-list">
                {!selectedProject ? (
                  <div className="thread-empty">请选择一个项目</div>
                ) : selectedThreads.length === 0 ? (
                  <div className="thread-empty">当前筛选下没有会话</div>
                ) : (
                  selectedThreads.map((thread) => (
                    <div
                      key={thread.id}
                      role="button"
                      tabIndex={0}
                      className={`thread-row ${
                        thread.status === "running" ? "is-live" : ""
                      }`}
                      onClick={() => props.onOpenThread(thread.id)}
                      onKeyDown={(event) =>
                        runKeyboardAction(event, () => props.onOpenThread(thread.id))
                      }
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
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyText(`thread:${thread.id}`, threadLabel(thread));
                            }}
                            onKeyDown={(event) => {
                              runKeyboardAction(event, () => {
                                void copyText(`thread:${thread.id}`, threadLabel(thread));
                              });
                            }}
                            title={
                              copiedKey === `thread:${thread.id}`
                                ? "已复制会话标题"
                                : "复制会话标题"
                            }
                            aria-label="复制会话标题"
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
                    ? "正在加载全部会话…"
                    : `查看全部会话（${selectedProject?.totalThreadCount ?? 0}）`}
                </button>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </aside>
  );
}
