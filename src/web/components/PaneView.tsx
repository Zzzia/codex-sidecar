import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronsUpDown,
  Maximize2,
  Minimize2,
  MoreVertical,
  X,
} from "lucide-react";
import type { ThreadStatus } from "@shared/types";
import { useThreadFeed } from "@web/hooks/useThreadFeed";
import { formatThreadTitle } from "@web/lib/threadTitle";
import { PaneProgress } from "./PaneProgress";
import { Timeline } from "./Timeline";
import "./PaneView.css";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const status = thread?.status ?? "idle";
  const projectName = thread?.displayName ?? props.threadId;
  const title = formatThreadTitle(
    thread?.title,
    thread?.displayName ?? props.threadId,
  );

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    window.addEventListener("pointerdown", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

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
          <div className="pane-menu-wrap" ref={menuRef}>
            <button
              className="icon-button"
              title="更多操作"
              aria-label="更多操作"
              aria-expanded={menuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((current) => !current);
              }}
            >
              <MoreVertical size={15} />
            </button>
            {menuOpen ? (
              <div className="pane-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    runMenuAction(props.onToggleOrientation);
                  }}
                >
                  <ChevronsUpDown size={14} />
                  <span>切换横竖分屏</span>
                </button>
                <button
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    runMenuAction(props.onSwap);
                  }}
                >
                  <ArrowLeftRight size={14} />
                  <span>和相邻分屏换位</span>
                </button>
                <button
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    runMenuAction(props.onToggleCollapse);
                  }}
                >
                  {props.collapsed ? (
                    <Maximize2 size={14} />
                  ) : (
                    <Minimize2 size={14} />
                  )}
                  <span>{props.collapsed ? "展开分屏" : "折叠分屏"}</span>
                </button>
              </div>
            ) : null}
          </div>
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
