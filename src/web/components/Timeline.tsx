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
} from "@web/lib/turns";
import {
  ExplorationDetailsModal,
  ToolDetailsModal,
} from "./TimelineInspectors";
import type { LocalFileContext } from "./localFilePreview";
import {
  findCurrentTurnCardIndex,
  readTimelineScrollAnchor,
  restoreTimelineScrollAnchor,
  type TimelineScrollAnchor,
} from "./timelineScrollAnchor";
import {
  TurnCard,
  type TimelineInspectTarget,
} from "./TimelineTurnCard";

type TimelineScrollBehavior = "auto" | "smooth";

function readTimelineScrollPosition(scrollerNode: HTMLElement) {
  const distanceToBottom =
    scrollerNode.scrollHeight - scrollerNode.clientHeight - scrollerNode.scrollTop;
  return {
    atTop: scrollerNode.scrollTop <= 8,
    atBottom: distanceToBottom <= 8,
  };
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
  const [selectedItem, setSelectedItem] = useState<TimelineInspectTarget | null>(null);
  const initialBottomIndex =
    cards.length > 0
      ? { index: cards.length - 1, align: "end" as const }
      : undefined;

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

    let userScrollFrame: number | null = null;

    const syncScrollState = () => {
      const { atTop, atBottom } = readTimelineScrollPosition(scrollerNode);
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

    const queueScrollStateSync = () => {
      if (userScrollFrame != null) {
        return;
      }
      userScrollFrame = requestAnimationFrame(() => {
        userScrollFrame = null;
        syncScrollState();
      });
    };

    const stopPendingProgrammaticScroll = () => {
      followScrollPending.current = false;
      queueScrollStateSync();
    };

    const frame = requestAnimationFrame(syncScrollState);
    scrollerNode.addEventListener("scroll", syncScrollState, { passive: true });
    scrollerNode.addEventListener("wheel", stopPendingProgrammaticScroll, {
      passive: true,
    });
    scrollerNode.addEventListener("touchmove", stopPendingProgrammaticScroll, {
      passive: true,
    });
    window.addEventListener("resize", syncScrollState);
    return () => {
      cancelAnimationFrame(frame);
      if (userScrollFrame != null) {
        cancelAnimationFrame(userScrollFrame);
      }
      scrollerNode.removeEventListener("scroll", syncScrollState);
      scrollerNode.removeEventListener("wheel", stopPendingProgrammaticScroll);
      scrollerNode.removeEventListener("touchmove", stopPendingProgrammaticScroll);
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

    const syncPositionAfterResize = () => {
      const { atTop, atBottom } = readTimelineScrollPosition(scrollerNode);
      scrollAnchorRef.current = readTimelineScrollAnchor(scrollerNode);
      setIsAtTop(atTop);
      setIsAtBottom(atBottom);
      if (atBottom) {
        followScrollPending.current = false;
      }
      if (!followScrollPending.current) {
        setFollowLatest(atBottom);
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
          syncPositionAfterResize();
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
          syncPositionAfterResize();
        });
      });
    };

    const resizeObserver = new ResizeObserver(preserveAnchorAfterResize);
    const observedElements = new Set<Element>();

    const observeRenderedTimelineItems = () => {
      const nextElements = new Set<Element>([
        scrollerNode,
        ...scrollerNode.querySelectorAll("[data-card-index], .timeline-end-spacer"),
      ]);

      for (const element of observedElements) {
        if (!nextElements.has(element)) {
          resizeObserver.unobserve(element);
          observedElements.delete(element);
        }
      }

      for (const element of nextElements) {
        if (!observedElements.has(element)) {
          resizeObserver.observe(element);
          observedElements.add(element);
        }
      }
    };
    observeRenderedTimelineItems();

    const mutationObserver = new MutationObserver(observeRenderedTimelineItems);
    mutationObserver.observe(scrollerNode, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      clearFrames();
    };
  }, [scrollerNode, cards.length]);

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
        initialTopMostItemIndex={initialBottomIndex}
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

          {!isAtBottom ? (
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
