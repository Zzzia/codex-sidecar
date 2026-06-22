import { useState } from "react";
import {
  Activity,
  Archive,
  ChevronDown,
  ChevronUp,
  Inbox,
  LayoutPanelTop,
  X,
} from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import {
  MAX_MAIN_PANE_OPTIONS,
  type AutoWorkspaceState,
  type AutoWorkspaceTrayState,
} from "@web/state/autoWorkspace";
import { formatThreadTitle } from "@web/lib/threadTitle";
import {
  buildTaskTrayViewModel,
  formatTrayTime,
  shouldScrollArchivedList,
} from "./taskTrayView";
import { ThreadPreviewModal } from "./ThreadPreviewModal";
import "./TaskTray.css";

type TrayGroupKey = keyof AutoWorkspaceTrayState;

interface TaskTrayProps {
  state: AutoWorkspaceState;
  summaries: ReadonlyMap<string, ThreadSummary>;
  maxMainPanes: number;
  syncError: string | null;
  onMaxMainPanesChange: (value: number) => void;
  onOpenPreview: (threadId: string) => void;
  onClosePreview: () => void;
  onArchiveThread: (threadId: string) => void;
  onPinToMain: (threadId: string) => void;
  onDismissNotice: () => void;
}

interface TrayGroupConfig {
  key: TrayGroupKey;
  label: string;
  icon: typeof Inbox;
}

const TRAY_GROUPS: TrayGroupConfig[] = [
  { key: "running", label: "Running", icon: Activity },
  { key: "pendingReview", label: "Needs review", icon: Inbox },
  { key: "archived", label: "Archived", icon: Archive },
];

function fallbackTitle(threadId: string): string {
  return threadId.length > 18 ? `${threadId.slice(0, 18)}…` : threadId;
}

function TrayItem({
  threadId,
  summary,
  onOpenPreview,
  onPinToMain,
}: {
  threadId: string;
  summary: ThreadSummary | null;
  onOpenPreview: (threadId: string) => void;
  onPinToMain: (threadId: string) => void;
}) {
  const status = summary?.status ?? "idle";
  const projectName = summary?.displayName ?? "Unknown project";
  const title = summary ? formatThreadTitle(summary.title, projectName) : fallbackTitle(threadId);

  return (
    <div className="task-tray-item">
      <button
        type="button"
        className="task-tray-item-preview"
        title={`${title}\n${summary?.cwd ?? threadId}`}
        onClick={() => onOpenPreview(threadId)}
      >
        <span className={`status-dot status-${status}`} />
        <span className="task-tray-item-copy">
          <span className="task-tray-item-project">{projectName}</span>
          <strong>{title}</strong>
        </span>
        <time>{formatTrayTime(summary?.updatedAt ?? 0)}</time>
      </button>
      <button
        type="button"
        className="task-tray-pin-button"
        title="Pin to main area"
        aria-label="Pin to main area"
        onClick={() => onPinToMain(threadId)}
      >
        <LayoutPanelTop size={13} />
      </button>
    </div>
  );
}

export function TaskTray(props: TaskTrayProps) {
  const [expanded, setExpanded] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<TrayGroupKey>("running");
  const view = buildTaskTrayViewModel(props.state, props.summaries);
  const previewSummary = props.state.previewThreadId
    ? props.summaries.get(props.state.previewThreadId) ?? null
    : null;

  const renderGroup = (group: TrayGroupConfig) => {
    const threadIds = props.state.tray[group.key];
    const Icon = group.icon;

    return (
      <section
        key={group.key}
        className={`task-tray-column ${
          group.key === "archived" && shouldScrollArchivedList(threadIds.length)
            ? "is-scrollable"
            : ""
        }`}
      >
        <header>
          <span>
            <Icon size={14} />
            {group.label}
          </span>
          <strong>{threadIds.length}</strong>
        </header>
        <div className="task-tray-list">
          {threadIds.length === 0 ? (
            <div className="task-tray-empty">No sessions</div>
          ) : (
            threadIds.map((threadId) => (
              <TrayItem
                key={threadId}
                threadId={threadId}
                summary={props.summaries.get(threadId) ?? null}
                onOpenPreview={props.onOpenPreview}
                onPinToMain={props.onPinToMain}
              />
            ))
          )}
        </div>
      </section>
    );
  };

  return (
    <>
      <div
        className={`task-tray ${expanded ? "is-expanded" : ""}`}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {expanded ? (
          <section className="task-tray-panel">
            <header className="task-tray-panel-header">
              <div className="task-tray-limit">
                <span>Main panes</span>
                <div className="task-tray-segmented" role="group" aria-label="Main panes">
                  {MAX_MAIN_PANE_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={value === props.maxMainPanes ? "is-active" : ""}
                      onClick={() => props.onMaxMainPanesChange(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                title="Collapse task tray"
                aria-label="Collapse task tray"
                onClick={() => setExpanded(false)}
              >
                <X size={15} />
              </button>
            </header>
            {props.state.pinnedThreadIds.length > props.maxMainPanes ? (
              <div className="task-tray-warning">
                {props.state.pinnedThreadIds.length} pinned sessions exceed the current limit
              </div>
            ) : null}
            {props.state.notice ? (
              <button
                type="button"
                className="task-tray-warning is-clickable"
                onClick={props.onDismissNotice}
              >
                {props.state.notice}
              </button>
            ) : null}
            {props.syncError ? (
              <div className="task-tray-warning">{props.syncError}</div>
            ) : null}
            <div className="task-tray-mobile-tabs">
              {TRAY_GROUPS.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className={mobileGroup === group.key ? "is-active" : ""}
                  onClick={() => setMobileGroup(group.key)}
                >
                  {group.label} {view.counts[group.key]}
                </button>
              ))}
            </div>
            <div className="task-tray-columns">
              {TRAY_GROUPS.map((group) => renderGroup(group))}
            </div>
            <div className="task-tray-mobile-panel">
              {renderGroup(TRAY_GROUPS.find((group) => group.key === mobileGroup)!)}
            </div>
          </section>
        ) : null}
        <button
          type="button"
          className="task-tray-bar"
          onClick={() => setExpanded((current) => !current)}
        >
          <span>Running {view.counts.running}</span>
          <span>Needs review {view.counts.pendingReview}</span>
          <span>Archived {view.counts.archived}</span>
          <strong>
            {view.latest
              ? `${formatThreadTitle(view.latest.title, view.latest.displayName)} · ${formatTrayTime(
                  view.latest.updatedAt,
                )}`
              : "No tray sessions"}
          </strong>
          {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {props.state.previewThreadId ? (
        <ThreadPreviewModal
          threadId={props.state.previewThreadId}
          summary={previewSummary}
          onClose={props.onClosePreview}
          onArchive={props.onArchiveThread}
          onPinToMain={props.onPinToMain}
        />
      ) : null}
    </>
  );
}
