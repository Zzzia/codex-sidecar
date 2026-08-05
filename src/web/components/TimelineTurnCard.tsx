import { memo } from "react";
import type { ThreadStatus } from "@shared/types";
import type {
  ExplorationStepView,
  ToolRunView,
  TurnCardView,
} from "@web/lib/turns";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { CompactionRunList } from "./TimelineCompaction";
import { formatTimestamp } from "./timelineHelpers";
import {
  ExplorationRunList,
  ToolRunList,
} from "./TimelineRuns";
import { InlinePatchRun } from "./TimelineInspectors";
import type { LocalFileContext } from "./localFilePreview";

export type TimelineInspectTarget =
  | {
      kind: "tool";
      tool: ToolRunView;
    }
  | {
      kind: "exploration";
      step: ExplorationStepView;
    };

function statusLabel(status: ThreadStatus, title: string): string {
  if (title) {
    return title;
  }
  if (status === "error") {
    return "Execution error";
  }
  return "Turn started";
}

function formatTurnDuration(startedAt: string, updatedAt: string): string {
  const startedMs = new Date(startedAt).getTime();
  const updatedMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(updatedMs)) {
    return "";
  }

  const totalSeconds = Math.max(0, Math.round((updatedMs - startedMs) / 1000));
  if (totalSeconds <= 0) {
    return "Less than 1s";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0
      ? `${hours} h ${minutes} min ${seconds} s`
      : `${hours} h ${minutes} min`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }

  return `${seconds} s`;
}

function TurnCardFooter({
  status,
  startedAt,
  updatedAt,
}: {
  status: ThreadStatus;
  startedAt: string;
  updatedAt: string;
}) {
  if (status === "running") {
    return (
      <footer className="turn-card-footer is-running" aria-label="Turn in progress">
        <span className="turn-card-loading" aria-hidden="true">
          ……
        </span>
      </footer>
    );
  }

  const duration = formatTurnDuration(startedAt, updatedAt);
  if (!duration) {
    return null;
  }

  const statusText =
    status === "error" ? "Ended with error" : status === "completed" ? "Completed" : "Idle";

  return (
    <footer className={`turn-card-footer ${status === "error" ? "is-error" : ""}`}>
      <span className="turn-card-metrics">
        {`${statusText} · Duration ${duration}`}
      </span>
    </footer>
  );
}

function TurnCardImpl({
  index,
  card,
  onInspectTool,
  onInspectExploration,
  localFileContext,
}: {
  index: number;
  card: TurnCardView;
  onInspectTool: (tool: ToolRunView) => void;
  onInspectExploration: (step: ExplorationStepView) => void;
  localFileContext: LocalFileContext | null;
}) {
  return (
    <article
      className={`turn-card ${index > 0 ? "has-previous-turn" : ""}`}
      data-card-id={card.id}
      data-card-index={index}
    >
      <header className="turn-card-header">
        <span className="turn-card-title-wrap">
          <span className={`turn-card-status status-${card.status}`} aria-hidden="true" />
          <span className="turn-card-title">
            {statusLabel(card.status, card.statusTitle)}
          </span>
        </span>
        <time className="turn-card-time" dateTime={card.startedAt}>
          {formatTimestamp(card.startedAt)}
        </time>
      </header>

      {card.userText ? (
        <section className="turn-question">
          <MarkdownRenderer text={card.userText} localFileContext={localFileContext} />
        </section>
      ) : null}

      {card.blocks.map((block) => {
        if (block.type === "assistant_markdown") {
          return (
            <section key={block.id} className="turn-answer">
              <MarkdownRenderer text={block.text} localFileContext={localFileContext} />
            </section>
          );
        }

        if (block.type === "proposed_plan") {
          return (
            <section key={block.id} className="turn-proposed-plan">
              <div className="turn-proposed-plan-label">Proposed Plan</div>
              <MarkdownRenderer text={block.text} localFileContext={localFileContext} />
            </section>
          );
        }

        if (block.type === "exploration_runs") {
          return (
            <section key={block.id} className="turn-exploration">
              <ExplorationRunList items={block.items} onInspect={onInspectExploration} />
            </section>
          );
        }

        if (block.type === "patch_runs") {
          return (
            <section key={block.id} className="turn-patches">
              {block.items.map((item) => (
                <InlinePatchRun
                  key={item.id}
                  item={item}
                  localFileContext={localFileContext}
                />
              ))}
            </section>
          );
        }

        if (block.type === "compaction_runs") {
          return (
            <section key={block.id} className="turn-compactions">
              <CompactionRunList items={block.items} />
            </section>
          );
        }

        return (
          <section key={block.id} className="turn-tools">
            <ToolRunList items={block.items} onInspect={onInspectTool} />
          </section>
        );
      })}

      <TurnCardFooter
        status={card.status}
        startedAt={card.startedAt}
        updatedAt={card.updatedAt}
      />
    </article>
  );
}

export const TurnCard = memo(TurnCardImpl);
