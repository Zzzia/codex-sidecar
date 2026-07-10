import test from "node:test";
import assert from "node:assert/strict";
import type { ThreadStatus, ThreadSummary } from "@shared/types";
import {
  closeAutoWorkspacePreview,
  createInitialAutoWorkspaceState,
  openAutoWorkspacePreview,
  pinAutoWorkspaceThreadToMain,
  setAutoWorkspaceMaxMainPanes,
  syncAutoWorkspaceThreads,
  unpinAutoWorkspaceThread,
} from "./autoWorkspace.js";
import {
  AUTO_WORKSPACE_STORAGE_KEY,
  loadAutoWorkspaceState,
  loadMaxMainPanes,
  saveAutoWorkspaceState,
  saveMaxMainPanes,
} from "./autoWorkspaceStorage.js";

function summary(
  id: string,
  status: ThreadStatus = "running",
  updatedAt = Number(id.replace(/\D/g, "")) || 1,
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
    firstUserMessage: `message-${id}`,
    status,
    eventCount: 1,
    contextWindowUsage: null,
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

test("max main panes setting defaults to 3 and persists allowed values", () => {
  const storage = fakeStorage();

  assert.equal(loadMaxMainPanes(storage), 3);
  saveMaxMainPanes(6, storage);
  assert.equal(loadMaxMainPanes(storage), 6);
  saveMaxMainPanes(9, storage);
  assert.equal(loadMaxMainPanes(storage), 3);
});

test("auto workspace persists its thread observation baseline", () => {
  const storage = fakeStorage();
  const state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    [summary("observed-thread", "completed", 10)],
    3,
  );

  saveAutoWorkspaceState(state, storage);

  assert.deepEqual(loadAutoWorkspaceState(storage), state);
});

test("stored workspace without observations establishes a fresh baseline", () => {
  const storage = fakeStorage({
    [AUTO_WORKSPACE_STORAGE_KEY]: JSON.stringify({
      visiblePaneThreadIds: [],
      pinnedThreadIds: [],
      tray: { pendingReview: [], running: [], archived: [] },
    }),
  });

  const state = loadAutoWorkspaceState(storage);

  assert.equal(state.threadObservationInitialized, false);
  assert.deepEqual(state.observedThreadUpdatedAtById, {});
});

test("stored workspace drops invalid thread observation timestamps", () => {
  const storage = fakeStorage({
    [AUTO_WORKSPACE_STORAGE_KEY]: JSON.stringify({
      visiblePaneThreadIds: [],
      pinnedThreadIds: [],
      tray: { pendingReview: [], running: [], archived: [] },
      threadObservationInitialized: true,
      observedThreadUpdatedAtById: {
        valid: 10,
        negative: -1,
        text: "20",
      },
    }),
  });

  const state = loadAutoWorkspaceState(storage);

  assert.deepEqual(state.observedThreadUpdatedAtById, { valid: 10 });
});

test("syncAutoWorkspaceThreads keeps at most max running panes visible", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
    summary("thread-4", "running", 40),
  ];

  const state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    threads,
    3,
  );

  assert.deepEqual(state.visiblePaneThreadIds, [
    "thread-4",
    "thread-3",
    "thread-2",
  ]);
  assert.deepEqual(state.tray.running, ["thread-1"]);
});

test("setAutoWorkspaceMaxMainPanes shrinks and expands automatic panes", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
    summary("thread-4", "running", 40),
  ];
  let state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    threads,
    3,
  );

  state = setAutoWorkspaceMaxMainPanes(state, threads, 2);
  assert.deepEqual(state.visiblePaneThreadIds, ["thread-4", "thread-3"]);
  assert.deepEqual(state.tray.running, ["thread-2", "thread-1"]);

  state = setAutoWorkspaceMaxMainPanes(state, threads, 4);
  assert.deepEqual(state.visiblePaneThreadIds, [
    "thread-4",
    "thread-3",
    "thread-2",
    "thread-1",
  ]);
  assert.deepEqual(state.tray.running, []);
});

test("lowering max evicts unpinned panes before pinned panes", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  const state = {
    ...syncAutoWorkspaceThreads(createInitialAutoWorkspaceState(), threads, 3),
    pinnedThreadIds: ["thread-1"],
  };

  const next = setAutoWorkspaceMaxMainPanes(state, threads, 2);

  assert.deepEqual(next.visiblePaneThreadIds, ["thread-1", "thread-3"]);
  assert.deepEqual(next.pinnedThreadIds, ["thread-1"]);
  assert.deepEqual(next.tray.running, ["thread-2"]);
});

test("pinned panes are ordered before automatic panes", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  const state = {
    ...syncAutoWorkspaceThreads(createInitialAutoWorkspaceState(), threads, 3),
    pinnedThreadIds: ["thread-2"],
  };

  const next = syncAutoWorkspaceThreads(state, threads, 3);

  assert.deepEqual(next.visiblePaneThreadIds, [
    "thread-2",
    "thread-3",
    "thread-1",
  ]);
  assert.deepEqual(next.pinnedThreadIds, ["thread-2"]);
});

test("pinned panes can exceed the current max without being closed", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  const state = {
    ...syncAutoWorkspaceThreads(createInitialAutoWorkspaceState(), threads, 3),
    pinnedThreadIds: ["thread-1", "thread-2", "thread-3"],
  };

  const next = setAutoWorkspaceMaxMainPanes(state, threads, 2);

  assert.deepEqual(next.visiblePaneThreadIds.sort(), [
    "thread-1",
    "thread-2",
    "thread-3",
  ]);
  assert.deepEqual(next.pinnedThreadIds.sort(), [
    "thread-1",
    "thread-2",
    "thread-3",
  ]);
});

test("pinning a tray item moves it to the main panel and pins it", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  const state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    threads,
    2,
  );

  const next = pinAutoWorkspaceThreadToMain(state, "thread-1", threads, 2);

  assert.deepEqual(next.visiblePaneThreadIds, ["thread-1", "thread-3"]);
  assert.deepEqual(next.pinnedThreadIds, ["thread-1"]);
  assert.deepEqual(next.tray.running, ["thread-2"]);
});

test("pinning is rejected when the main panel is full of pinned panes", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  const state = {
    ...syncAutoWorkspaceThreads(createInitialAutoWorkspaceState(), threads, 2),
    pinnedThreadIds: ["thread-2", "thread-3"],
  };

  const next = pinAutoWorkspaceThreadToMain(state, "thread-1", threads, 2);

  assert.deepEqual(next.visiblePaneThreadIds.sort(), ["thread-2", "thread-3"]);
  assert.match(next.notice ?? "", /2 pinned sessions/);
});

test("unpinning over-limit panes allows automatic trimming", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  const state = {
    ...syncAutoWorkspaceThreads(createInitialAutoWorkspaceState(), threads, 3),
    pinnedThreadIds: ["thread-1", "thread-2", "thread-3"],
  };

  const next = unpinAutoWorkspaceThread(state, "thread-1", threads, 2);

  assert.deepEqual(next.visiblePaneThreadIds.sort(), ["thread-2", "thread-3"]);
  assert.deepEqual(next.tray.running, ["thread-1"]);
});

test("running tray completion moves to pending, preview close archives it", () => {
  const running = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  let state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    running,
    2,
  );

  const completed = [
    summary("thread-1", "completed", 40),
    summary("thread-2", "running", 20),
    summary("thread-3", "running", 30),
  ];
  state = syncAutoWorkspaceThreads(state, completed, 2);
  assert.deepEqual(state.tray.pendingReview, ["thread-1"]);

  state = openAutoWorkspacePreview(state, "thread-1");
  state = closeAutoWorkspacePreview(state, completed);
  assert.deepEqual(state.tray.pendingReview, []);
  assert.deepEqual(state.tray.archived, ["thread-1"]);
});

test("completed thread discovered after the initial baseline enters pending review", () => {
  const historical = summary("historical", "completed", 10);
  let state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    [historical],
    3,
  );
  assert.deepEqual(state.tray.pendingReview, []);

  state = syncAutoWorkspaceThreads(
    state,
    [historical, summary("fast-thread", "completed", 20)],
    3,
  );

  assert.deepEqual(state.visiblePaneThreadIds, []);
  assert.deepEqual(state.tray.pendingReview, ["fast-thread"]);
});

test("archived thread completed between polls returns to pending review", () => {
  const completed = summary("resumed-thread", "completed", 10);
  let state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    [completed],
    3,
  );
  state = {
    ...state,
    tray: {
      ...state.tray,
      archived: ["resumed-thread"],
    },
  };

  state = syncAutoWorkspaceThreads(
    state,
    [summary("resumed-thread", "completed", 20)],
    3,
  );

  assert.deepEqual(state.tray.pendingReview, ["resumed-thread"]);
  assert.deepEqual(state.tray.archived, []);
});

test("archived thread returns to the main area when it resumes", () => {
  const completed = summary("resumed-thread", "completed", 10);
  let state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    [completed],
    3,
  );
  state = {
    ...state,
    tray: {
      ...state.tray,
      archived: ["resumed-thread"],
    },
  };

  state = syncAutoWorkspaceThreads(
    state,
    [summary("resumed-thread", "running", 20)],
    3,
  );

  assert.deepEqual(state.visiblePaneThreadIds, ["resumed-thread"]);
  assert.deepEqual(state.tray.archived, []);
});

test("running thread parked in the tray stays there while it continues", () => {
  const state = {
    ...createInitialAutoWorkspaceState(),
    tray: {
      pendingReview: [],
      running: ["parked-thread"],
      archived: [],
    },
  };

  const next = syncAutoWorkspaceThreads(
    state,
    [summary("parked-thread", "running", 20)],
    3,
  );

  assert.deepEqual(next.visiblePaneThreadIds, []);
  assert.deepEqual(next.tray.running, ["parked-thread"]);
});

test("opening preview does not change visible panes", () => {
  const threads = [
    summary("thread-1", "running", 10),
    summary("thread-2", "running", 20),
  ];
  const state = syncAutoWorkspaceThreads(
    createInitialAutoWorkspaceState(),
    threads,
    1,
  );

  const preview = openAutoWorkspacePreview(state, "thread-1");

  assert.deepEqual(preview.visiblePaneThreadIds, state.visiblePaneThreadIds);
  assert.equal(preview.previewThreadId, "thread-1");
});
