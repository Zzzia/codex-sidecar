import { startTransition, useEffect, useState } from "react";
import type { StreamEnvelope, ThreadSnapshot, ThreadSummary, TimelineEvent } from "@shared/types";

interface ThreadFeedState {
  thread: ThreadSummary | null;
  events: TimelineEvent[];
  cursor: number;
  loading: boolean;
  error: string | null;
}

export function useThreadFeed(threadId: string): ThreadFeedState {
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

          startTransition(() => {
            setState((current) => {
              const nextThread = current.thread
                ? {
                    ...current.thread,
                    status:
                      payload.event?.kind === "status"
                        ? payload.event.status
                        : payload.event?.kind === "patch" && !payload.event.success
                          ? "error"
                          : current.thread.status,
                    eventCount: payload.cursor,
                  }
                : current.thread;

              return {
                thread: nextThread,
                events: [...current.events, payload.event!],
                cursor: payload.cursor,
                loading: false,
                error: null,
              };
            });
          });
        });

        source.addEventListener("ready", (event) => {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as StreamEnvelope;
          setState((current) => ({
            ...current,
            cursor: payload.cursor,
          }));
        });

        source.onerror = () => {
          if (!disposed) {
            setState((current) => ({
              ...current,
              error: "事件流连接中断，浏览器会自动重连",
            }));
          }
        };
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
      source?.close();
    };
  }, [threadId]);

  return state;
}
