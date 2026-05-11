import type { ThreadStatus } from "@shared/types";
import {
  buildTurnCards,
  type ExplorationStepView,
  type ToolRunView,
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
    return "执行异常";
  }
  return "对话开始";
}

function formatTurnDuration(startedAt: string, updatedAt: string): string {
  const startedMs = new Date(startedAt).getTime();
  const updatedMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(updatedMs)) {
    return "";
  }

  const totalSeconds = Math.max(0, Math.round((updatedMs - startedMs) / 1000));
  if (totalSeconds <= 0) {
    return "少于 1 秒";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0
      ? `${hours} 小时 ${minutes} 分 ${seconds} 秒`
      : `${hours} 小时 ${minutes} 分`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }

  return `${seconds} 秒`;
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
      <footer className="turn-card-footer is-running" aria-label="对话进行中">
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
    status === "error" ? "异常结束" : status === "completed" ? "已结束" : "待机";

  return (
    <footer className={`turn-card-footer ${status === "error" ? "is-error" : ""}`}>
      <span className="turn-card-metrics">
        {`${statusText} · 用时 ${duration}`}
      </span>
    </footer>
  );
}

export function TurnCard({
  index,
  card,
  onInspectTool,
  onInspectExploration,
  localFileContext,
}: {
  index: number;
  card: ReturnType<typeof buildTurnCards>[number];
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
