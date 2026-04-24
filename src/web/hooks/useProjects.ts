import { useEffect, useRef, useState } from "react";
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

function mergeProjectSummaries(
  projects: ProjectSummary[],
  current: ProjectRecord[],
): ProjectRecord[] {
  const currentMap = new Map(current.map((item) => [item.cwd, item]));
  return projects.map((project) => {
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
}

function collectLoadedThreadIds(projects: ProjectRecord[]): string[] {
  const ids = new Set<string>();
  for (const project of projects) {
    for (const thread of project.loadedThreads) {
      ids.add(thread.id);
    }
  }
  return [...ids].slice(0, 100);
}

function applyThreadSummaries(
  projects: ProjectRecord[],
  summaries: ThreadSummary[],
): ProjectRecord[] {
  if (summaries.length === 0) {
    return projects;
  }

  const summaryMap = new Map(summaries.map((thread) => [thread.id, thread]));
  const updateThread = (thread: ThreadSummary): ThreadSummary =>
    summaryMap.get(thread.id) ?? thread;

  return projects.map((project) => {
    const recentThreads = project.recentThreads.map(updateThread);
    const loadedThreads = mergeThreads(project.loadedThreads.map(updateThread), recentThreads);
    return {
      ...project,
      activeThreadCount: loadedThreads.filter((thread) => thread.status === "running").length,
      latestUpdatedAt: Math.max(
        project.latestUpdatedAt,
        ...loadedThreads.map((thread) => thread.updatedAt),
      ),
      recentThreads,
      loadedThreads,
    };
  });
}

export function useProjects(): ProjectsState {
  const [items, setItems] = useState<ProjectRecord[]>([]);
  const itemsRef = useRef<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

        const mergedProjects = mergeProjectSummaries(data.items, itemsRef.current);
        const summaryIds = collectLoadedThreadIds(mergedProjects);
        const summaryParams = new URLSearchParams();
        for (const id of summaryIds) {
          summaryParams.append("id", id);
        }
        const summaryData =
          summaryIds.length > 0
            ? await fetchJson<{ items: ThreadSummary[] }>(
                `/api/thread-summaries?${summaryParams.toString()}`,
              )
            : { items: [] };
        if (cancelled) {
          return;
        }

        setItems((currentItems) => {
          const nextItems = applyThreadSummaries(
            mergeProjectSummaries(data.items, currentItems),
            summaryData.items,
          );
          itemsRef.current = nextItems;
          return sameProjectRecords(currentItems, nextItems) ? currentItems : nextItems;
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
