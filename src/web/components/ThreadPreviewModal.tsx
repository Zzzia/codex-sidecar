import { Archive, LayoutPanelTop, X } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { useThreadFeed } from "@web/hooks/useThreadFeed";
import { formatThreadTitle } from "@web/lib/threadTitle";
import { PaneProgress } from "./PaneProgress";
import { Timeline } from "./Timeline";

interface ThreadPreviewModalProps {
  threadId: string;
  summary: ThreadSummary | null;
  onClose: () => void;
  onArchive: (threadId: string) => void;
  onPinToMain: (threadId: string) => void;
}

export function ThreadPreviewModal(props: ThreadPreviewModalProps) {
  const { thread, events, loading, error } = useThreadFeed(props.threadId, "active");
  const summary = thread ?? props.summary;
  const status = summary?.status ?? "idle";
  const projectName = summary?.displayName ?? props.threadId;
  const title = formatThreadTitle(summary?.title, projectName);
  const canArchive = status !== "running";

  return (
    <div className="thread-preview-backdrop" role="dialog" aria-modal="true">
      <section className="thread-preview-modal">
        <header className="thread-preview-header">
          <div className="thread-preview-title-wrap">
            <div className={`status-dot status-${status}`} />
            <span className="thread-preview-project" title={projectName}>
              {projectName}
            </span>
            <span className="thread-preview-divider">/</span>
            <h2 title={title}>{title}</h2>
          </div>
          <div className="thread-preview-actions">
            <button
              type="button"
              className="tray-action-button"
              disabled={!canArchive}
              title={canArchive ? "已看完并收纳" : "运行中的会话暂不收纳"}
              onClick={() => props.onArchive(props.threadId)}
            >
              <Archive size={14} />
              <span>已看完并收纳</span>
            </button>
            <button
              type="button"
              className="tray-action-button primary"
              onClick={() => props.onPinToMain(props.threadId)}
            >
              <LayoutPanelTop size={14} />
              <span>放到主面板</span>
            </button>
            <button
              type="button"
              className="icon-button"
              title="关闭预览"
              aria-label="关闭预览"
              onClick={props.onClose}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="thread-preview-body">
          {loading ? <div className="pane-placeholder">会话加载中…</div> : null}
          {error ? <div className="pane-error">{error}</div> : null}
          {!loading && !error ? (
            <>
              <Timeline
                threadId={props.threadId}
                cwd={summary?.cwd ?? ""}
                events={events}
                threadStatus={status}
              />
              <PaneProgress events={events} threadStatus={status} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
