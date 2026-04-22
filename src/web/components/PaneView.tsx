import {
  ArrowLeftRight,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import type { ThreadStatus } from "@shared/types";
import { useThreadFeed } from "@web/hooks/useThreadFeed";
import { PaneProgress } from "./PaneProgress";
import { Timeline } from "./Timeline";

function statusLabel(status: ThreadStatus): string {
  if (status === "running") return "对话中";
  if (status === "completed") return "已结束";
  if (status === "error") return "异常";
  return "待机";
}

export interface PaneViewProps {
  threadId: string;
  collapsed: boolean;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onToggleCollapse: () => void;
  onSwap: () => void;
  onToggleOrientation: () => void;
}

export function PaneView(props: PaneViewProps) {
  const { thread, events, loading, error } = useThreadFeed(props.threadId);
  const status = thread?.status ?? "idle";

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
          <div className="pane-title-group">
            <strong className="pane-title">
              {thread?.displayName ?? props.threadId}
            </strong>
            <span className="pane-subtitle">
              {statusLabel(status)}
              {thread?.cliVersion ? ` · CLI ${thread.cliVersion}` : ""}
            </span>
          </div>
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
            <>
              <Timeline threadId={props.threadId} events={events} />
              <PaneProgress events={events} threadStatus={status} />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
