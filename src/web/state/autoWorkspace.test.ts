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
  loadMaxMainPanes,
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
