import { useEffect, useRef, useState } from "react";
import { ArrowDown, CircleAlert, TerminalSquare } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ThreadStatus } from "@shared/types";
import "./Timeline.css";
import {
  buildTurnCards,
  type ExplorationStepView,
  type ToolRunView,
} from "@web/lib/turns";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  ExplorationDetailsModal,
  InlinePatchRun,
  ToolDetailsModal,
} from "./TimelineInspectors";
import {
  explorationLabel,
  explorationMeta,
  explorationState,
  formatTimestamp,
  summarizeExplorationStep,
} from "./timelineHelpers";

function statusLabel(status: ThreadStatus, title: string): string {
  if (title) {
    return title;
  }
  if (status === "running") {
    return "对话中";
  }
  if (status === "completed") {
    return "对话结束";
  }
  if (status === "error") {
    return "执行异常";
  }
  return "待机";
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.max(16, Math.floor(maxLength * 0.6));
  const tail = Math.max(10, maxLength - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function toolDisplayName(tool: ToolRunView): string {
  if (tool.name === "exec_command") {
    return "Run";
  }
  return tool.name;
}

function toolBadgeText(tool: ToolRunView): string {
  if (tool.patchSummary) {
    return tool.patchSummary;
  }

  if (tool.result?.success === false) {
    return tool.result.exitCode != null ? `exit ${tool.result.exitCode}` : "异常";
  }

  if (tool.status === "failed") {
    return "异常";
  }

  if (tool.result?.exitCode != null && tool.result.exitCode !== 0) {
    return `exit ${tool.result.exitCode}`;
  }

  if (tool.result?.success === true && tool.name === "exec_command") {
    return "";
  }

  return tool.status === "completed" ? "" : tool.status ?? "";
}

type InspectTarget =
  | {
      kind: "tool";
      tool: ToolRunView;
    }
  | {
      kind: "exploration";
      step: ExplorationStepView;
    };

function ToolRunList({
  items,
  onInspect,
}: {
  items: ToolRunView[];
  onInspect: (tool: ToolRunView) => void;
}) {
  return (
    <div className="turn-tool-list">
      {items.map((tool) => {
        const hasError = tool.result?.success === false || tool.patchSuccess === false;
        const hasSuccess =
          tool.result?.success === true ||
          (tool.patchSuccess === true && tool.patchChanges.length > 0);
        const badgeText = toolBadgeText(tool);

        return (
          <button
            key={tool.id}
            className={`tool-run-row ${hasError ? "is-error" : hasSuccess ? "is-success" : ""}`}
            onClick={() => onInspect(tool)}
            title={`${tool.preview}\n点击查看详情`}
          >
            <span className="tool-run-icon">
              {hasError ? <CircleAlert size={14} /> : <TerminalSquare size={14} />}
            </span>
            <span className="tool-run-main">
              <span className="tool-run-name">{toolDisplayName(tool)}</span>
              <code className="tool-run-preview">
                {truncateMiddle(tool.preview, 110)}
              </code>
            </span>
            {badgeText ? <span className="tool-run-badge">{badgeText}</span> : null}
            <span className="tool-run-hint">查看详情</span>
          </button>
        );
      })}
    </div>
  );
}

function ExplorationRunList({
  items,
  onInspect,
}: {
  items: ExplorationStepView[];
  onInspect: (step: ExplorationStepView) => void;
}) {
  return (
    <div className="turn-exploration-list">
      {items.map((step) => {
        const state = explorationState(step);
        const meta = explorationMeta(step);

        return (
          <button
            key={step.id}
            className={`exploration-row is-${state}`}
            onClick={() => onInspect(step)}
            title={summarizeExplorationStep(step)}
          >
            <span className="exploration-label">{explorationLabel(step)}</span>
            <span className="exploration-main">
              <code className="exploration-summary">
                {truncateMiddle(summarizeExplorationStep(step), 140)}
              </code>
              {meta ? <span className="exploration-meta">{meta}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TurnCard({
  card,
  onInspectTool,
  onInspectExploration,
}: {
  card: ReturnType<typeof buildTurnCards>[number];
  onInspectTool: (tool: ToolRunView) => void;
  onInspectExploration: (step: ExplorationStepView) => void;
}) {
  return (
    <article className="turn-card">
      <header className="turn-card-header">
        <div>
          <strong>{statusLabel(card.status, card.statusTitle)}</strong>
        </div>
        <time>{formatTimestamp(card.updatedAt)}</time>
      </header>

      {card.userText ? (
        <section className="turn-question">
          <MarkdownRenderer text={card.userText} />
        </section>
      ) : null}

      {card.blocks.map((block) => {
        if (block.type === "assistant_markdown") {
          return (
            <section key={block.id} className="turn-answer">
              <MarkdownRenderer text={block.text} />
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
                <InlinePatchRun key={item.id} item={item} />
              ))}
            </section>
          );
        }

        return (
          <section key={block.id} className="turn-tools">
            <ToolRunList items={block.items} onInspect={onInspectTool} />
          </section>
        );
      })}
    </article>
  );
}

export function Timeline({
  threadId,
  events,
}: {
  threadId: string;
  events: Parameters<typeof buildTurnCards>[0];
}) {
  const cards = buildTurnCards(events);
  const listRef = useRef<VirtuosoHandle | null>(null);
  const didInitialScroll = useRef(false);
  const followJumpPending = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [followLatest, setFollowLatest] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InspectTarget | null>(null);

  useEffect(() => {
    didInitialScroll.current = false;
    followJumpPending.current = false;
    setIsAtBottom(true);
    setFollowLatest(true);
    setSelectedItem(null);
  }, [threadId]);

  useEffect(() => {
    if (cards.length === 0 || didInitialScroll.current) {
      return;
    }

    didInitialScroll.current = true;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: cards.length - 1,
        align: "end",
        behavior: "auto",
      });
    });
  }, [cards.length]);

  const jumpToBottom = () => {
    if (cards.length === 0) {
      return;
    }
    followJumpPending.current = true;
    setIsAtBottom(true);
    setFollowLatest(true);
    listRef.current?.scrollToIndex({
      index: cards.length - 1,
      align: "end",
      behavior: "auto",
    });
  };

  return (
    <div className="timeline-shell">
      <Virtuoso
        ref={listRef}
        data={cards}
        alignToBottom
        followOutput={(atBottom) => (followLatest || atBottom ? "smooth" : false)}
        atBottomStateChange={(atBottom) => {
          setIsAtBottom(atBottom);
          if (!atBottom && followJumpPending.current) {
            return;
          }

          if (atBottom) {
            followJumpPending.current = false;
          }
          setFollowLatest(atBottom);
        }}
        itemContent={(index, card) => (
          <TurnCard
            card={card}
            onInspectTool={(tool) => setSelectedItem({ kind: "tool", tool })}
            onInspectExploration={(step) => setSelectedItem({ kind: "exploration", step })}
          />
        )}
      />

      {!isAtBottom ? (
        <button className="jump-latest-button" onClick={jumpToBottom}>
          <ArrowDown size={15} />
          回到底部并跟随
        </button>
      ) : null}

      {selectedItem?.kind === "tool" ? (
        <ToolDetailsModal
          tool={selectedItem.tool}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}

      {selectedItem?.kind === "exploration" ? (
        <ExplorationDetailsModal
          step={selectedItem.step}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </div>
  );
}
