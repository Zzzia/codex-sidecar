import { Archive, LayoutPanelTop } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { useThreadFeed } from "@web/hooks/useThreadFeed";
import { formatThreadTitle } from "@web/lib/threadTitle";
import { PaneProgress } from "./PaneProgress";
import { PreviewModalShell } from "./PreviewModalShell";
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
    <PreviewModalShell
      ariaLabel="Session preview"
      eyebrow="Session preview"
      title={
        <>
          <div className={`status-dot status-${status}`} />
          <span className="thread-preview-project" title={projectName}>
            {projectName}
          </span>
          <span className="thread-preview-divider">/</span>
          <h2 title={title}>{title}</h2>
        </>
      }
      titleText={`${projectName} / ${title}`}
      actions={
        <>
          <button
            type="button"
            className="tray-action-button"
            disabled={!canArchive}
            title={canArchive ? "Reviewed and archived" : "Running sessions cannot be archived"}
            onClick={() => props.onArchive(props.threadId)}
          >
            <Archive size={14} />
            <span>Reviewed and archived</span>
          </button>
          <button
            type="button"
            className="tray-action-button primary"
            onClick={() => props.onPinToMain(props.threadId)}
          >
            <LayoutPanelTop size={14} />
            <span>Pin to main area</span>
          </button>
        </>
      }
      bodyClassName="thread-preview-body"
      onClose={props.onClose}
    >
      {loading ? <div className="pane-placeholder">Loading session...</div> : null}
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
    </PreviewModalShell>
  );
}
