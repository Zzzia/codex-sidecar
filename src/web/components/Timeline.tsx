import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type TurnCardView,
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
  distanceToBottom,
  isNearBottom,
  isScrollTopDecreased,
  nextStickToBottom,
  stickAfterScroll,
} from "./timelineStickToBottom";
import {
  TurnCard,
  type TimelineInspectTarget,
} from "./TimelineTurnCard";

type TimelineScrollBehavior = "auto" | "smooth";

function readTimelineScrollPosition(scrollerNode: HTMLElement) {
  const distance = distanceToBottom(
    scrollerNode.scrollHeight,
    scrollerNode.clientHeight,
    scrollerNode.scrollTop,
  );
  return {
    atTop: scrollerNode.scrollTop <= 8,
    atBottom: isNearBottom(distance),
  };
}

function TimelineFooterSpacer() {
  return <div className="timeline-end-spacer" aria-hidden="true" />;
}

const VIRTUOSO_COMPONENTS = { Footer: TimelineFooterSpacer };

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
  const cards = useMemo(
    () => resolveTurnCardStatuses(buildTurnCards(events), threadStatus),
    [events, threadStatus],
  );
  const localFileContext = useMemo(
    () =>
      cwd.trim().length > 0
        ? ({ threadId, cwd } satisfies LocalFileContext)
        : null,
    [cwd, threadId],
  );
  const listRef = useRef<VirtuosoHandle | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [scrollerNode, setScrollerNode] = useState<HTMLElement | null>(null);
  const didPrimeScrollRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const userIntentScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const visibleStartIndexRef = useRef(0);
  const scrollAnchorRef = useRef<TimelineScrollAnchor | null>(null);
  const stickToBottomRef = useRef(true);
  const lastListHeightRef = useRef(0);
  const [isAtTop, setIsAtTop] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [selectedItem, setSelectedItem] = useState<TimelineInspectTarget | null>(
    null,
  );
  const initialBottomIndex =
    cards.length > 0
      ? { index: cards.length - 1, align: "end" as const }
      : undefined;

  const applyStick = useCallback((next: boolean) => {
    stickToBottomRef.current = next;
    setStickToBottom(next);
  }, []);

  useEffect(() => {
    didPrimeScrollRef.current = false;
    programmaticScrollRef.current = false;
    userIntentScrollRef.current = false;
    lastScrollTopRef.current = 0;
    lastListHeightRef.current = 0;
    scrollAnchorRef.current = null;
    applyStick(nextStickToBottom(false, "reset_thread"));
    setIsAtTop(true);
    setSelectedItem(null);
  }, [applyStick, threadId]);

  const scrollTimelineToBottom = useCallback(
    (behavior: TimelineScrollBehavior) => {
      if (cards.length === 0) {
        return;
      }

      programmaticScrollRef.current = true;
      userIntentScrollRef.current = false;
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
    },
    [cards.length],
  );

  useEffect(() => {
    if (!stickToBottom || cards.length === 0 || events.length === 0) {
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
  }, [cards.length, events.length, scrollTimelineToBottom, stickToBottom]);

  useEffect(() => {
    if (!scrollerNode) {
      return;
    }

    let userScrollFrame: number | null = null;

    const syncScrollState = () => {
      const previousScrollTop = lastScrollTopRef.current;
      const scrollTop = scrollerNode.scrollTop;
      lastScrollTopRef.current = scrollTop;

      const { atTop, atBottom } = readTimelineScrollPosition(scrollerNode);
      scrollAnchorRef.current = readTimelineScrollAnchor(scrollerNode);
      setIsAtTop(atTop);

      const userIntent =
        userIntentScrollRef.current ||
        isScrollTopDecreased(previousScrollTop, scrollTop);

      const decision = stickAfterScroll({
        stick: stickToBottomRef.current,
        atBottom,
        programmatic: programmaticScrollRef.current,
        userIntent,
      });

      programmaticScrollRef.current = decision.programmatic;
      // Consume one-shot user intent once scroll has been evaluated.
      userIntentScrollRef.current = false;

      if (decision.stick !== stickToBottomRef.current) {
        applyStick(decision.stick);
      }
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

    const markUserScrollIntent = () => {
      programmaticScrollRef.current = false;
      userIntentScrollRef.current = true;
      queueScrollStateSync();
    };

    // Scrollbar interactions target the scroller element itself, not children.
    const markScrollbarPointerIntent = (event: PointerEvent) => {
      if (event.target !== scrollerNode) {
        return;
      }
      markUserScrollIntent();
    };

    lastScrollTopRef.current = scrollerNode.scrollTop;
    const frame = requestAnimationFrame(syncScrollState);
    scrollerNode.addEventListener("scroll", syncScrollState, { passive: true });
    scrollerNode.addEventListener("wheel", markUserScrollIntent, {
      passive: true,
    });
    scrollerNode.addEventListener("touchmove", markUserScrollIntent, {
      passive: true,
    });
    scrollerNode.addEventListener("pointerdown", markScrollbarPointerIntent, {
      passive: true,
    });
    window.addEventListener("resize", syncScrollState);
    return () => {
      cancelAnimationFrame(frame);
      if (userScrollFrame != null) {
        cancelAnimationFrame(userScrollFrame);
      }
      scrollerNode.removeEventListener("scroll", syncScrollState);
      scrollerNode.removeEventListener("wheel", markUserScrollIntent);
      scrollerNode.removeEventListener("touchmove", markUserScrollIntent);
      scrollerNode.removeEventListener("pointerdown", markScrollbarPointerIntent);
      window.removeEventListener("resize", syncScrollState);
    };
  }, [applyStick, scrollerNode]);

  // Preserve scroll position when list height changes (content growth / reflow).
  // Prefer Virtuoso's totalListHeightChanged + a single scroller ResizeObserver
  // over subtree MutationObserver + per-card ResizeObserver.
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
      lastScrollTopRef.current = scrollerNode.scrollTop;
      setIsAtTop(atTop);

      // Resize / content growth never clears stick intent.
      if (atBottom) {
        programmaticScrollRef.current = false;
        userIntentScrollRef.current = false;
        if (!stickToBottomRef.current) {
          applyStick(nextStickToBottom(false, "enter_by_arrive"));
        }
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

        if (anchor.atBottom || stickToBottomRef.current) {
          programmaticScrollRef.current = true;
          userIntentScrollRef.current = false;
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
          if (!stickToBottomRef.current) {
            restoreTimelineScrollAnchor(scrollerNode, anchor);
          }
          syncPositionAfterResize();
        });
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      preserveAnchorAfterResize();
    });
    resizeObserver.observe(scrollerNode);

    return () => {
      resizeObserver.disconnect();
      clearFrames();
    };
  }, [applyStick, scrollerNode]);

  const handleTotalListHeightChanged = useCallback((height: number) => {
    if (height === lastListHeightRef.current) {
      return;
    }
    lastListHeightRef.current = height;

    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const anchor =
      scrollAnchorRef.current ?? readTimelineScrollAnchor(scroller);
    if (!anchor) {
      return;
    }

    if (anchor.atBottom || stickToBottomRef.current) {
      programmaticScrollRef.current = true;
      userIntentScrollRef.current = false;
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }

    restoreTimelineScrollAnchor(scroller, anchor);
  }, []);

  const jumpToBottom = () => {
    if (cards.length === 0) {
      return;
    }
    applyStick(nextStickToBottom(stickToBottomRef.current, "enter_by_jump"));
    didPrimeScrollRef.current = true;
    scrollTimelineToBottom("auto");
  };

  const jumpToTop = () => {
    if (cards.length === 0) {
      return;
    }

    programmaticScrollRef.current = false;
    userIntentScrollRef.current = true;
    applyStick(nextStickToBottom(stickToBottomRef.current, "leave_by_jump_top"));
    const currentIndex = scrollerRef.current
      ? findCurrentTurnCardIndex(scrollerRef.current)
      : visibleStartIndexRef.current;

    listRef.current?.scrollToIndex({
      index: Math.max(0, currentIndex ?? 0),
      align: "start",
      behavior: "auto",
    });
  };

  const onInspectTool = useCallback((tool: ToolRunView) => {
    setSelectedItem({ kind: "tool", tool });
  }, []);

  const onInspectExploration = useCallback((step: ExplorationStepView) => {
    setSelectedItem({ kind: "exploration", step });
  }, []);

  const itemContent = useCallback(
    (index: number, card: TurnCardView) => (
      <TurnCard
        index={index}
        card={card}
        onInspectTool={onInspectTool}
        onInspectExploration={onInspectExploration}
        localFileContext={localFileContext}
      />
    ),
    [localFileContext, onInspectExploration, onInspectTool],
  );

  const handleRangeChanged = useCallback(
    (range: { startIndex: number }) => {
      visibleStartIndexRef.current = range.startIndex;
    },
    [],
  );

  const handleScrollerRef = useCallback((node: HTMLElement | Window | null) => {
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
  }, []);

  return (
    <div className="timeline-shell">
      <Virtuoso
        ref={listRef}
        data={cards}
        alignToBottom
        components={VIRTUOSO_COMPONENTS}
        computeItemKey={(_, card) => card.id}
        followOutput={stickToBottom ? "smooth" : false}
        initialTopMostItemIndex={initialBottomIndex}
        rangeChanged={handleRangeChanged}
        totalListHeightChanged={handleTotalListHeightChanged}
        scrollerRef={handleScrollerRef}
        itemContent={itemContent}
      />

      {!isAtTop || !stickToBottom ? (
        <div className="timeline-jump-stack">
          {!isAtTop ? (
            <button
              className="timeline-jump-button"
              onClick={jumpToTop}
              title="Back to current turn top"
            >
              <ArrowUp size={15} />
            </button>
          ) : null}

          {!stickToBottom ? (
            <button
              className="timeline-jump-button"
              onClick={jumpToBottom}
              title="Follow latest"
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
