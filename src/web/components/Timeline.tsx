import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  CircleAlert,
  TerminalSquare,
} from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ThreadStatus } from "@shared/types";
import "./Timeline.css";
import {
  buildTurnCards,
  resolveTurnCardStatuses,
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
  index,
  card,
  onInspectTool,
  onInspectExploration,
}: {
  index: number;
  card: ReturnType<typeof buildTurnCards>[number];
  onInspectTool: (tool: ToolRunView) => void;
  onInspectExploration: (step: ExplorationStepView) => void;
}) {
  return (
    <article className="turn-card" data-card-index={index}>
      <header className="turn-card-header">
        <span className="turn-card-title">{statusLabel(card.status, card.statusTitle)}</span>
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

      <TurnCardFooter
        status={card.status}
        startedAt={card.startedAt}
        updatedAt={card.updatedAt}
      />
    </article>
  );
}

function TimelineFooterSpacer() {
  return <div className="timeline-end-spacer" aria-hidden="true" />;
}

function findCurrentTurnCard(scroller: HTMLElement): HTMLElement | null {
  const cards = Array.from(
    scroller.querySelectorAll<HTMLElement>(".turn-card"),
  );
  if (cards.length === 0) {
    return null;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const viewportTop = scrollerRect.top + 8;
  const viewportBottom = scrollerRect.bottom - 8;

  let crossingTop: HTMLElement | null = null;
  let crossingTopOffset = Number.NEGATIVE_INFINITY;
  let firstVisibleBelow: HTMLElement | null = null;
  let firstVisibleBelowOffset = Number.POSITIVE_INFINITY;

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= viewportTop || rect.top >= viewportBottom) {
      continue;
    }

    const offset = rect.top - scrollerRect.top;
    if (rect.top <= viewportTop && offset > crossingTopOffset) {
      crossingTop = card;
      crossingTopOffset = offset;
      continue;
    }

    if (offset < firstVisibleBelowOffset) {
      firstVisibleBelow = card;
      firstVisibleBelowOffset = offset;
    }
  }

  return crossingTop ?? firstVisibleBelow ?? cards[0] ?? null;
}

function findCurrentTurnCardIndex(scroller: HTMLElement): number | null {
  const card = findCurrentTurnCard(scroller);
  if (!card) {
    return null;
  }

  const value = Number(card.dataset.cardIndex ?? "");
  return Number.isInteger(value) ? value : null;
}

export function Timeline({
  threadId,
  events,
  threadStatus,
}: {
  threadId: string;
  events: Parameters<typeof buildTurnCards>[0];
  threadStatus: ThreadStatus;
}) {
  const cards = resolveTurnCardStatuses(buildTurnCards(events), threadStatus);
  const listRef = useRef<VirtuosoHandle | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [scrollerNode, setScrollerNode] = useState<HTMLElement | null>(null);
  const followScrollPending = useRef(false);
  const visibleStartIndexRef = useRef(0);
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [followLatest, setFollowLatest] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InspectTarget | null>(null);

  useEffect(() => {
    followScrollPending.current = false;
    setIsAtTop(true);
    setIsAtBottom(true);
    setFollowLatest(true);
    setSelectedItem(null);
  }, [threadId]);

  useEffect(() => {
    if (!followLatest || cards.length === 0 || events.length === 0) {
      return;
    }

    followScrollPending.current = true;
    const frame = requestAnimationFrame(() => {
      if (scrollerRef.current) {
        scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
        return;
      }

      listRef.current?.scrollToIndex({
        index: cards.length - 1,
        align: "end",
        behavior: "auto",
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [cards.length, events.length, followLatest]);

  useEffect(() => {
    if (!scrollerNode) {
      return;
    }

    const syncScrollState = () => {
      const distanceToBottom =
        scrollerNode.scrollHeight - scrollerNode.clientHeight - scrollerNode.scrollTop;
      const atTop = scrollerNode.scrollTop <= 8;
      const atBottom = distanceToBottom <= 8;

      setIsAtTop(atTop);
      setIsAtBottom(atBottom);

      if (!atBottom && followScrollPending.current) {
        return;
      }

      if (atBottom) {
        followScrollPending.current = false;
      }

      setFollowLatest(atBottom);
    };

    const frame = requestAnimationFrame(syncScrollState);
    scrollerNode.addEventListener("scroll", syncScrollState, { passive: true });
    window.addEventListener("resize", syncScrollState);
    return () => {
      cancelAnimationFrame(frame);
      scrollerNode.removeEventListener("scroll", syncScrollState);
      window.removeEventListener("resize", syncScrollState);
    };
  }, [scrollerNode, cards.length]);

  const jumpToBottom = () => {
    if (cards.length === 0) {
      return;
    }
    followScrollPending.current = true;
    setFollowLatest(true);
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
      return;
    }

    listRef.current?.scrollToIndex({
      index: cards.length - 1,
      align: "end",
      behavior: "auto",
    });
  };

  const jumpToTop = () => {
    if (cards.length === 0) {
      return;
    }

    followScrollPending.current = false;
    setFollowLatest(false);
    const currentIndex = scrollerRef.current
      ? findCurrentTurnCardIndex(scrollerRef.current)
      : visibleStartIndexRef.current;

    listRef.current?.scrollToIndex({
      index: Math.max(0, currentIndex ?? 0),
      align: "start",
      behavior: "auto",
    });
  };

  return (
    <div className="timeline-shell">
      <Virtuoso
        ref={listRef}
        data={cards}
        alignToBottom
        components={{ Footer: TimelineFooterSpacer }}
        followOutput={followLatest ? "auto" : false}
        rangeChanged={(range) => {
          visibleStartIndexRef.current = range.startIndex;
        }}
        scrollerRef={(node) => {
          if (scrollerRef.current && scrollerRef.current !== node) {
            scrollerRef.current.classList.remove("timeline-scroller");
          }

          if (node instanceof HTMLElement) {
            scrollerRef.current = node;
            setScrollerNode(node);
            node.classList.add("timeline-scroller");
            return;
          }

          scrollerRef.current = null;
          setScrollerNode(null);
        }}
        itemContent={(index, card) => (
          <TurnCard
            index={index}
            card={card}
            onInspectTool={(tool) => setSelectedItem({ kind: "tool", tool })}
            onInspectExploration={(step) => setSelectedItem({ kind: "exploration", step })}
          />
        )}
      />

      {!isAtTop || !isAtBottom ? (
        <div className="timeline-jump-stack">
          {!isAtTop ? (
            <button
              className="timeline-jump-button"
              onClick={jumpToTop}
              title="回到当前对话顶部"
            >
              <ArrowUp size={15} />
            </button>
          ) : null}

          {!followLatest && !isAtBottom ? (
            <button
              className="timeline-jump-button"
              onClick={jumpToBottom}
              title="回到底部并跟随"
            >
              <ArrowDownToLine size={15} />
            </button>
          ) : null}
        </div>
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
