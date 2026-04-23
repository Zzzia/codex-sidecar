import { startTransition, useEffect, useRef, useState } from "react";
import type {
  StreamEnvelope,
  ThreadDelta,
  ThreadSnapshot,
  ThreadStatus,
  ThreadSummary,
  TimelineEvent,
} from "@shared/types";

interface ThreadFeedState {
  thread: ThreadSummary | null;
  events: TimelineEvent[];
  cursor: number;
  loading: boolean;
  error: string | null;
}

const DELTA_POLL_INTERVAL_MS = 5000;

function statusAfterEvent(
  currentStatus: ThreadStatus,
  event: TimelineEvent,
): ThreadStatus {
  if (event.kind === "status") {
    return event.status;
  }
  if (event.kind === "patch" && !event.success) {
    return "error";
  }
  return currentStatus;
}

function mergeTimelineEvent(
  current: ThreadFeedState,
  event: TimelineEvent,
  cursor: number,
): ThreadFeedState {
  const nextCursor = Math.max(current.cursor, cursor);
  const nextThread = current.thread
    ? {
        ...current.thread,
        status: statusAfterEvent(current.thread.status, event),
        eventCount: nextCursor,
      }
    : current.thread;

  if (current.events.some((item) => item.id === event.id)) {
    return {
      ...current,
      thread: nextThread,
      cursor: nextCursor,
      loading: false,
      error: null,
    };
  }

  return {
    thread: nextThread,
    events: [...current.events, event],
    cursor: nextCursor,
    loading: false,
    error: null,
  };
}

function mergeDelta(
  current: ThreadFeedState,
  delta: ThreadDelta,
): ThreadFeedState {
  const knownIds = new Set(current.events.map((event) => event.id));
  const nextEvents = delta.events.filter((event) => !knownIds.has(event.id));

  return {
    thread: {
      ...delta.thread,
      eventCount: Math.max(delta.thread.eventCount, delta.nextCursor),
    },
    events:
      nextEvents.length > 0
        ? [...current.events, ...nextEvents]
        : current.events,
    cursor: Math.max(current.cursor, delta.nextCursor),
    loading: false,
    error: null,
  };
}

export function useThreadFeed(threadId: string): ThreadFeedState {
  const cursorRef = useRef(0);
  const [state, setState] = useState<ThreadFeedState>({
    thread: null,
    events: [],
    cursor: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: number | null = null;
    let refreshingDelta = false;
    cursorRef.current = 0;

    const applyDelta = (delta: ThreadDelta) => {
      cursorRef.current = Math.max(cursorRef.current, delta.nextCursor);
      startTransition(() => {
        setState((current) => mergeDelta(current, delta));
      });
    };

    const refreshDelta = async () => {
      if (disposed || refreshingDelta) {
        return;
      }

      refreshingDelta = true;
      try {
        const response = await fetch(
          `/api/threads/${threadId}/events?after=${cursorRef.current}`,
        );
        if (!response.ok) {
          throw new Error(`增量事件加载失败: ${response.status}`);
        }
        const delta = (await response.json()) as ThreadDelta;
        if (!disposed) {
          applyDelta(delta);
        }
      } catch (error) {
        if (!disposed) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "增量事件加载失败",
          }));
        }
      } finally {
        refreshingDelta = false;
      }
    };

    const connect = async () => {
      try {
        setState((current) => ({
          ...current,
          loading: true,
          error: null,
        }));

        const response = await fetch(`/api/threads/${threadId}/snapshot`);
        if (!response.ok) {
          throw new Error(`会话快照加载失败: ${response.status}`);
        }
        const snapshot = (await response.json()) as ThreadSnapshot;
        if (disposed) {
          return;
        }
        cursorRef.current = snapshot.nextCursor;

        setState({
          thread: snapshot.thread,
          events: snapshot.events,
          cursor: snapshot.nextCursor,
          loading: false,
          error: null,
        });

        source = new EventSource(
          `/api/threads/${threadId}/stream?after=${snapshot.nextCursor}`,
        );

        source.addEventListener("timeline", (event) => {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as StreamEnvelope;
          if (!payload.event || disposed) {
            return;
          }

          cursorRef.current = Math.max(cursorRef.current, payload.cursor);
          startTransition(() => {
            setState((current) =>
              mergeTimelineEvent(current, payload.event!, payload.cursor),
            );
          });
        });

        source.addEventListener("ready", (event) => {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as StreamEnvelope;
          cursorRef.current = Math.max(cursorRef.current, payload.cursor);
          setState((current) => ({
            ...current,
            cursor: Math.max(current.cursor, payload.cursor),
            error: null,
          }));
        });

        source.onerror = () => {
          if (!disposed) {
            setState((current) => ({
              ...current,
              error: "事件流连接中断，正在使用增量同步恢复",
            }));
            void refreshDelta();
          }
        };

        pollTimer = window.setInterval(() => {
          void refreshDelta();
        }, DELTA_POLL_INTERVAL_MS);
      } catch (error) {
        if (!disposed) {
          setState({
            thread: null,
            events: [],
            cursor: 0,
            loading: false,
            error:
              error instanceof Error ? error.message : "会话数据加载失败",
          });
        }
      }
    };

    void connect();

    return () => {
      disposed = true;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
      source?.close();
    };
  }, [threadId]);

  return state;
}
