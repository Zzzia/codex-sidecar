import { useEffect, useState } from "react";
import type { ProjectSummary, ThreadPage, ThreadSummary } from "@shared/types";

interface ProjectRecord extends ProjectSummary {
  loadedThreads: ThreadSummary[];
  nextCursor: string | null;
}

interface ProjectsState {
  items: ProjectRecord[];
  loading: boolean;
  error: string | null;
  loadMore: (cwd: string) => Promise<void>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  return (await response.json()) as T;
}

function mergeThreads(
  first: ThreadSummary[],
  second: ThreadSummary[],
): ThreadSummary[] {
  const map = new Map<string, ThreadSummary>();
  for (const item of [...first, ...second]) {
    map.set(item.id, item);
  }
  return [...map.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

function sameThreads(first: ThreadSummary[], second: ThreadSummary[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((item, index) => {
    const other = second[index];
    return (
      other != null &&
      item.id === other.id &&
      item.title === other.title &&
      item.displayName === other.displayName &&
      item.updatedAt === other.updatedAt &&
      item.status === other.status &&
      item.eventCount === other.eventCount
    );
  });
}

function sameProjectRecords(first: ProjectRecord[], second: ProjectRecord[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((item, index) => {
    const other = second[index];
    return (
      other != null &&
      item.cwd === other.cwd &&
      item.displayName === other.displayName &&
      item.latestUpdatedAt === other.latestUpdatedAt &&
      item.activeThreadCount === other.activeThreadCount &&
      item.totalThreadCount === other.totalThreadCount &&
      item.nextCursor === other.nextCursor &&
      sameThreads(item.recentThreads, other.recentThreads) &&
      sameThreads(item.loadedThreads, other.loadedThreads)
    );
  });
}

export function useProjects(): ProjectsState {
  const [items, setItems] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (initial = false) => {
      try {
        if (initial) {
          setLoading(true);
        }
        const data = await fetchJson<{ items: ProjectSummary[] }>("/api/projects");
        if (cancelled) {
          return;
        }

        setItems((current) => {
          const currentMap = new Map(current.map((item) => [item.cwd, item]));
          const nextItems = data.items.map((project) => {
            const existing = currentMap.get(project.cwd);
            const merged = mergeThreads(
              project.recentThreads,
              existing?.loadedThreads ?? [],
            );
            return {
              ...project,
              loadedThreads: merged,
              nextCursor: existing?.nextCursor ?? null,
            };
          });

          return sameProjectRecords(current, nextItems) ? current : nextItems;
        });
        setError(null);
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "项目列表加载失败",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void refresh(true);
    const timer = window.setInterval(() => {
      void refresh(false);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const loadMore = async (cwd: string) => {
    const target = items.find((item) => item.cwd === cwd);
    if (!target) {
      return;
    }

    let mergedThreads = target.loadedThreads;
    let nextCursor = target.nextCursor;
    const shouldFetchFirstPage =
      !nextCursor && target.loadedThreads.length < target.totalThreadCount;

    if (!nextCursor && !shouldFetchFirstPage) {
      return;
    }

    do {
      const params = new URLSearchParams({ cwd });
      if (nextCursor) {
        params.set("cursor", nextCursor);
      }
      const data = await fetchJson<ThreadPage>(`/api/threads?${params.toString()}`);
      mergedThreads = mergeThreads(mergedThreads, data.items);
      nextCursor = data.nextCursor;
    } while (nextCursor);

    setItems((current) =>
      current.map((item) => {
        if (item.cwd !== cwd) {
          return item;
        }
        return {
          ...item,
          loadedThreads: mergeThreads(item.loadedThreads, mergedThreads),
          nextCursor,
        };
      }),
    );
  };

  return {
    items,
    loading,
    error,
    loadMore,
  };
}
