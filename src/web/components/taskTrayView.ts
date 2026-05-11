import type { ThreadSummary } from "@shared/types";
import type { AutoWorkspaceState } from "@web/state/autoWorkspace";

export function formatTrayTime(timestamp: number): string {
  if (!timestamp) {
    return "--:--";
  }
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shouldScrollArchivedList(count: number): boolean {
  return count > 10;
}

export function buildTaskTrayViewModel(
  state: AutoWorkspaceState,
  summaries: ReadonlyMap<string, ThreadSummary>,
) {
  const groups = {
    pendingReview: state.tray.pendingReview.map((id) => summaries.get(id) ?? null),
    running: state.tray.running.map((id) => summaries.get(id) ?? null),
    archived: state.tray.archived.map((id) => summaries.get(id) ?? null),
  };
  const allSummaries = Object.values(groups)
    .flat()
    .filter((summary): summary is ThreadSummary => summary != null);
  const latest =
    allSummaries.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;

  return {
    counts: {
      pendingReview: state.tray.pendingReview.length,
      running: state.tray.running.length,
      archived: state.tray.archived.length,
    },
    latest,
    groups,
  };
}
