import type { ThreadStatus, TimelineEvent } from "@shared/types";
import { extractThreadProgress } from "@web/lib/progress";
import "./PaneProgress.css";

function formatTimestamp(ts: string): string {
  if (!ts) {
    return "";
  }

  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusSymbol(status: "pending" | "in_progress" | "completed"): string {
  if (status === "completed") {
    return "✓";
  }
  if (status === "in_progress") {
    return "●";
  }
  return "○";
}

export function PaneProgress({
  events,
  threadStatus,
}: {
  events: TimelineEvent[];
  threadStatus: ThreadStatus;
}) {
  const progress = extractThreadProgress(events, threadStatus);
  if (!progress) {
    return null;
  }

  return (
    <footer className="pane-progress">
      <div className="pane-progress-header">
        <span className="pane-progress-title">进度</span>
        <time className="pane-progress-time">{formatTimestamp(progress.ts)}</time>
      </div>

      {progress.explanation ? (
        <p className="pane-progress-explanation">{progress.explanation}</p>
      ) : null}

      <div className="pane-progress-list">
        {progress.items.map((item) => (
          <div
            key={`${progress.ts}:${item.step}`}
            className={`pane-progress-step is-${item.status}`}
          >
            <span className="pane-progress-symbol">{statusSymbol(item.status)}</span>
            <span className="pane-progress-text">{item.step}</span>
          </div>
        ))}
      </div>
    </footer>
  );
}
