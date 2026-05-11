import test from "node:test";
import assert from "node:assert/strict";
import type { ThreadStatus, ThreadSummary } from "@shared/types";
import {
  buildTaskTrayViewModel,
  formatTrayTime,
  shouldScrollArchivedList,
} from "./taskTrayView.js";
import type { AutoWorkspaceState } from "@web/state/autoWorkspace";

function summary(
  id: string,
  status: ThreadStatus,
  updatedAt: number,
): ThreadSummary {
  return {
    id,
    cwd: `/repo/${id}`,
    displayName: `repo-${id}`,
    title: `title-${id}`,
    createdAt: updatedAt - 1,
    updatedAt,
    cliVersion: "0.1.0",
    source: "cli",
    rolloutPath: `/tmp/${id}.jsonl`,
    firstUserMessage: "",
    status,
    eventCount: 1,
    contextWindowUsage: null,
  };
}

function trayState(overrides: Partial<AutoWorkspaceState> = {}): AutoWorkspaceState {
  return {
    visiblePaneThreadIds: [],
    pinnedThreadIds: [],
    tray: {
      pendingReview: [],
      running: [],
      archived: [],
    },
    previewThreadId: null,
    notice: null,
    ...overrides,
  };
}

test("buildTaskTrayViewModel exposes tray counts and latest summary", () => {
  const summaries = new Map([
    ["pending-1", summary("pending-1", "completed", Date.UTC(2026, 4, 11, 8, 10))],
    ["running-1", summary("running-1", "running", Date.UTC(2026, 4, 11, 8, 20))],
    ["archived-1", summary("archived-1", "completed", Date.UTC(2026, 4, 11, 8, 5))],
  ]);
  const view = buildTaskTrayViewModel(
    trayState({
      tray: {
        pendingReview: ["pending-1"],
        running: ["running-1"],
        archived: ["archived-1"],
      },
    }),
    summaries,
  );

  assert.deepEqual(view.counts, {
    pendingReview: 1,
    running: 1,
    archived: 1,
  });
  assert.equal(view.latest?.id, "running-1");
});

test("formatTrayTime renders compact hour minute labels", () => {
  assert.match(formatTrayTime(Date.UTC(2026, 4, 11, 8, 20)), /^\d{2}:\d{2}$/);
  assert.equal(formatTrayTime(0), "--:--");
});

test("shouldScrollArchivedList only enables internal scroll after ten items", () => {
  assert.equal(shouldScrollArchivedList(10), false);
  assert.equal(shouldScrollArchivedList(11), true);
});
