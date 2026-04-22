import { memo } from "react";
import {
  ArrowLeftRight,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import type { ThreadStatus } from "@shared/types";
import { useThreadFeed } from "@web/hooks/useThreadFeed";
import { formatThreadTitle } from "@web/lib/threadTitle";
import { PaneProgress } from "./PaneProgress";
import { Timeline } from "./Timeline";

export interface PaneViewProps {
  threadId: string;
  collapsed: boolean;
  suspended: boolean;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onToggleCollapse: () => void;
  onSwap: () => void;
  onToggleOrientation: () => void;
}

const PaneContent = memo(function PaneContent({
  threadId,
  events,
  status,
}: {
  threadId: string;
  events: Parameters<typeof Timeline>[0]["events"];
  status: ThreadStatus;
}) {
  return (
    <>
      <Timeline threadId={threadId} events={events} threadStatus={status} />
      <PaneProgress events={events} threadStatus={status} />
    </>
  );
});

export function PaneView(props: PaneViewProps) {
  const { thread, events, loading, error } = useThreadFeed(props.threadId);
  const status = thread?.status ?? "idle";
  const projectName = thread?.displayName ?? props.threadId;
  const title = formatThreadTitle(
    thread?.title,
    thread?.displayName ?? props.threadId,
  );

  return (
    <section
      className={`pane-view ${props.active ? "is-active" : ""} ${
        props.collapsed ? "is-collapsed" : ""
      }`}
      onMouseDown={props.onSelect}
    >
      <header className="pane-header">
        <div className="pane-title-wrap">
          <div className={`status-dot status-${status}`} />
          <span className="pane-project-name" title={projectName}>
            {projectName}
          </span>
          <span className="pane-title-divider" aria-hidden="true">
            /
          </span>
          <span className="pane-title" title={title}>
            {title}
          </span>
        </div>
        <div className="pane-actions">
          <button className="icon-button" title="切换横竖分屏" onClick={props.onToggleOrientation}>
            <ChevronsUpDown size={15} />
          </button>
          <button className="icon-button" title="和相邻分屏换位" onClick={props.onSwap}>
            <ArrowLeftRight size={15} />
          </button>
          <button className="icon-button" title={props.collapsed ? "展开" : "折叠"} onClick={props.onToggleCollapse}>
            {props.collapsed ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          </button>
          <button className="icon-button danger" title="关闭分屏" onClick={props.onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      {!props.collapsed ? (
        <div className="pane-body">
          {loading ? <div className="pane-placeholder">会话加载中…</div> : null}
          {error ? <div className="pane-error">{error}</div> : null}
          {!loading && !error ? (
            <div className={`pane-content ${props.suspended ? "is-suspended" : ""}`}>
              <PaneContent
                threadId={props.threadId}
                events={events}
                status={status}
              />
            </div>
          ) : null}
          {props.suspended && !loading && !error ? (
            <div className="pane-suspend-overlay">正在调整分栏布局…</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
