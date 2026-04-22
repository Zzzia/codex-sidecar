import { ChevronLeft, ChevronRight, Clock3, FolderGit2, LoaderCircle } from "lucide-react";
import type { ThreadStatus } from "@shared/types";
import type { ProjectSummary, ThreadSummary } from "@shared/types";

function statusLabel(status: ThreadStatus): string {
  if (status === "running") return "对话中";
  if (status === "completed") return "已结束";
  if (status === "error") return "异常";
  return "待机";
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ProjectSidebarProps {
  projects: Array<ProjectSummary & { loadedThreads: ThreadSummary[]; nextCursor: string | null }>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  sidebarOpen: boolean;
  activeOnlyByProject: Record<string, boolean>;
  onToggleSidebar: () => void;
  onToggleProjectMode: (cwd: string) => void;
  onOpenThread: (threadId: string) => void;
  onLoadMore: (cwd: string) => void;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  return (
    <aside className={`project-sidebar ${props.sidebarOpen ? "is-open" : "is-closed"}`}>
      <div className="sidebar-header">
        <div>
          <div className="sidebar-eyebrow">Local Observer</div>
          <h1>Codex 会话工作台</h1>
        </div>
        <button className="icon-button" onClick={props.onToggleSidebar}>
          {props.sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {props.sidebarOpen ? (
        <>
          <div className="sidebar-meta">
            <span>{props.refreshing ? "正在刷新…" : "每 5 秒自动刷新"}</span>
            {props.refreshing ? <LoaderCircle size={14} className="spin" /> : null}
          </div>
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
                      <div>
                        <strong>{project.displayName}</strong>
                        <p>{project.cwd}</p>
                      </div>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() => props.onToggleProjectMode(project.cwd)}
                    >
                      {activeOnly ? "显示最近" : "只看活跃"}
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
                        >
                          <div className={`status-dot status-${thread.status}`} />
                          <div className="thread-copy">
                            <strong>{thread.displayName}</strong>
                            <span>{statusLabel(thread.status)}</span>
                          </div>
                          <time>{timeLabel(thread.updatedAt)}</time>
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
