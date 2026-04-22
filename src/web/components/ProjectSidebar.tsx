import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Filter,
  FolderGit2,
} from "lucide-react";
import type { ProjectSummary, ThreadSummary } from "@shared/types";
import { formatThreadTitle } from "@web/lib/threadTitle";
import "./ProjectSidebar.css";

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
  activeOnlyByProject: Record<string, boolean>;
  onToggleSidebar: () => void;
  onToggleProjectMode: (cwd: string) => void;
  onOpenThread: (threadId: string) => void;
  onLoadMore: (cwd: string) => void;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  return (
    <aside className={`project-sidebar ${props.sidebarOpen ? "is-open" : "is-closed"}`}>
      {props.sidebarOpen ? (
        <div className="sidebar-header">
          <div className="sidebar-header-copy">
            <div className="sidebar-eyebrow">Local Observer</div>
            <h1>Codex 会话工作台</h1>
          </div>
          <button
            className="icon-button"
            onClick={props.onToggleSidebar}
            title="收起侧栏"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      ) : (
        <div className="sidebar-header is-rail">
          <div className="sidebar-rail-brand" title="Sidecar">
            SC
          </div>
          <button
            className="icon-button"
            onClick={props.onToggleSidebar}
            title="展开侧栏"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {props.sidebarOpen ? (
        <>
          {props.loading ? <div className="sidebar-empty">工程列表加载中…</div> : null}
          {props.error ? <div className="sidebar-error">{props.error}</div> : null}
          <div className="project-list">
            {props.projects.map((project) => {
              const activeOnly = props.activeOnlyByProject[project.cwd] ?? false;
              const threads = activeOnly
                ? project.loadedThreads.filter((thread) => thread.status === "running")
                : project.loadedThreads;

              return (
                <section key={project.cwd} className="project-card">
                  <header className="project-card-header">
                    <div className="project-title-wrap">
                      <FolderGit2 size={16} />
                      <div className="project-title-main">
                        <strong title={project.displayName}>{project.displayName}</strong>
                        <div className="project-path-row">
                          <p title={project.cwd}>{project.cwd}</p>
                          <button
                            className={`sidebar-copy-button ${
                              copiedKey === `project:${project.cwd}` ? "is-copied" : ""
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyText(`project:${project.cwd}`, project.cwd);
                            }}
                            title={
                              copiedKey === `project:${project.cwd}` ? "已复制工程路径" : "复制工程路径"
                            }
                            aria-label="复制工程路径"
                          >
                            {copiedKey === `project:${project.cwd}` ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      className={`sidebar-filter-button ${activeOnly ? "is-active" : ""}`}
                      onClick={() => props.onToggleProjectMode(project.cwd)}
                      title={activeOnly ? "显示最近会话" : "只看活跃会话"}
                      aria-label={activeOnly ? "显示最近会话" : "只看活跃会话"}
                    >
                      <Filter size={14} />
                    </button>
                  </header>
                  <div className="project-stats">
                    <span>{project.activeThreadCount} 活跃</span>
                    <span>{project.totalThreadCount} 会话</span>
                    <span className="project-updated">
                      <Clock3 size={12} />
                      {timeLabel(project.latestUpdatedAt)}
                    </span>
                  </div>
                  <div className="thread-list">
                    {threads.length === 0 ? (
                      <div className="thread-empty">当前筛选下没有会话</div>
                    ) : (
                      threads.map((thread) => (
                        <button
                          key={thread.id}
                          className="thread-row"
                          onClick={() => props.onOpenThread(thread.id)}
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
                              <button
                                className={`sidebar-copy-button ${
                                  copiedKey === `thread:${thread.id}` ? "is-copied" : ""
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void copyText(`thread:${thread.id}`, threadLabel(thread));
                                }}
                                title={
                                  copiedKey === `thread:${thread.id}` ? "已复制会话标题" : "复制会话标题"
                                }
                                aria-label="复制会话标题"
                              >
                                {copiedKey === `thread:${thread.id}` ? (
                                  <Check size={12} />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </div>
                          </div>
                          <time title={new Date(thread.updatedAt).toLocaleString("zh-CN")}>
                            {timeLabel(thread.updatedAt)}
                          </time>
                        </button>
                      ))
                    )}
                  </div>
                  {project.nextCursor ? (
                    <button
                      className="load-more-button"
                      onClick={() => props.onLoadMore(project.cwd)}
                    >
                      加载更多会话
                    </button>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <div className="sidebar-rail">
          {props.projects.map((project) => (
            <button
              key={project.cwd}
              className="rail-project"
              onClick={() => {
                const firstThreadId = project.recentThreads[0]?.id;
                if (firstThreadId) {
                  props.onOpenThread(firstThreadId);
                }
              }}
              title={project.displayName}
            >
              <span>{project.displayName.slice(0, 2).toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
