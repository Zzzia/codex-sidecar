import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
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
import { ExplorationRunList, ToolRunList } from "./TimelineRuns";
import type { LocalFileContext } from "./localFilePreview";
import {
  findCurrentTurnCardIndex,
  readTimelineScrollAnchor,
  restoreTimelineScrollAnchor,
  type TimelineScrollAnchor,
} from "./timelineScrollAnchor";
import { formatTimestamp } from "./timelineHelpers";

type TimelineScrollBehavior = "auto" | "smooth";

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

function TurnCard({
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

export function Timeline({
  threadId,
  cwd,
  events,
  threadStatus,
}: {
  threadId: string;
  cwd: string;
  events: Parameters<typeof buildTurnCards>[0];
  threadStatus: ThreadStatus;
}) {
  const cards = resolveTurnCardStatuses(buildTurnCards(events), threadStatus);
  const localFileContext =
    cwd.trim().length > 0 ? { threadId, cwd } satisfies LocalFileContext : null;
  const listRef = useRef<VirtuosoHandle | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [scrollerNode, setScrollerNode] = useState<HTMLElement | null>(null);
  const didPrimeScrollRef = useRef(false);
  const followScrollPending = useRef(false);
  const visibleStartIndexRef = useRef(0);
  const scrollAnchorRef = useRef<TimelineScrollAnchor | null>(null);
  const followLatestRef = useRef(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [followLatest, setFollowLatest] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InspectTarget | null>(null);

  useEffect(() => {
    didPrimeScrollRef.current = false;
    followScrollPending.current = false;
    scrollAnchorRef.current = null;
    followLatestRef.current = true;
    setIsAtTop(true);
    setIsAtBottom(true);
    setFollowLatest(true);
    setSelectedItem(null);
  }, [threadId]);

  const scrollTimelineToBottom = (behavior: TimelineScrollBehavior) => {
    if (cards.length === 0) {
      return;
    }

    followScrollPending.current = true;
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior,
      });
      return;
    }

    listRef.current?.scrollToIndex({
      index: cards.length - 1,
      align: "end",
      behavior,
    });
  };

  useEffect(() => {
    followLatestRef.current = followLatest;
  }, [followLatest]);

  useEffect(() => {
    if (!followLatest || cards.length === 0 || events.length === 0) {
      return;
    }

    const behavior: TimelineScrollBehavior = didPrimeScrollRef.current
      ? "smooth"
      : "auto";
    didPrimeScrollRef.current = true;
    const frame = requestAnimationFrame(() => {
      scrollTimelineToBottom(behavior);
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
      scrollAnchorRef.current = readTimelineScrollAnchor(scrollerNode);

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

  useEffect(() => {
    if (!scrollerNode) {
      return;
    }

    let frame: number | null = null;
    let settleFrame: number | null = null;

    const clearFrames = () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      if (settleFrame != null) {
        window.cancelAnimationFrame(settleFrame);
        settleFrame = null;
      }
    };

    const preserveAnchorAfterResize = () => {
      const anchor =
        scrollAnchorRef.current ?? readTimelineScrollAnchor(scrollerNode);
      if (!anchor) {
        return;
      }

      clearFrames();
      frame = window.requestAnimationFrame(() => {
        frame = null;

        if (anchor.atBottom || followLatestRef.current) {
          scrollerNode.scrollTop = scrollerNode.scrollHeight;
          scrollAnchorRef.current = readTimelineScrollAnchor(scrollerNode);
          return;
        }

        const restored = restoreTimelineScrollAnchor(scrollerNode, anchor);
        if (!restored) {
          listRef.current?.scrollToIndex({
            index: Math.max(0, anchor.cardIndex),
            align: "start",
            behavior: "auto",
          });
        }

        settleFrame = window.requestAnimationFrame(() => {
          settleFrame = null;
          if (!followLatestRef.current) {
            restoreTimelineScrollAnchor(scrollerNode, anchor);
          }
          scrollAnchorRef.current = readTimelineScrollAnchor(scrollerNode);
        });
      });
    };

    const resizeObserver = new ResizeObserver(preserveAnchorAfterResize);
    resizeObserver.observe(scrollerNode);

    return () => {
      resizeObserver.disconnect();
      clearFrames();
    };
  }, [scrollerNode]);

  const jumpToBottom = () => {
    if (cards.length === 0) {
      return;
    }
    setFollowLatest(true);
    didPrimeScrollRef.current = true;
    scrollTimelineToBottom("auto");
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
        computeItemKey={(_, card) => card.id}
        followOutput={followLatest ? "smooth" : false}
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
            localFileContext={localFileContext}
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
          localFileContext={localFileContext}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}

      {selectedItem?.kind === "exploration" ? (
        <ExplorationDetailsModal
          step={selectedItem.step}
          localFileContext={localFileContext}
          onClose={() => setSelectedItem(null)}
        />
      ) : null}
    </div>
  );
}
