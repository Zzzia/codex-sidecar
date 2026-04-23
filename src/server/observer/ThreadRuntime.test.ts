import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ThreadRuntime } from "./ThreadRuntime.js";
import type { ThreadRow } from "./types.js";

function eventMsg(type: string, timestamp: string) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type },
  });
}

test("getSnapshot refreshes appended terminal events after initial load", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-runtime-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const rolloutPath = path.join(workspace, "rollout.jsonl");
  await writeFile(
    rolloutPath,
    `${eventMsg("task_started", "2026-04-23T08:00:00.000Z")}\n`,
  );

  const row: ThreadRow = {
    id: "thread-1",
    rollout_path: rolloutPath,
    created_at_ms: 1,
    updated_at_ms: 2,
    source: "cli",
    cwd: workspace,
    title: "demo",
    cli_version: "0.123.0",
    first_user_message: "hello",
  };
  const runtime = new ThreadRuntime(row);

  const firstSnapshot = await runtime.getSnapshot();
  assert.equal(firstSnapshot.thread.status, "running");

  await appendFile(
    rolloutPath,
    `${eventMsg("task_complete", "2026-04-23T08:00:01.000Z")}\n`,
  );

  const refreshedSnapshot = await runtime.getSnapshot();
  assert.equal(refreshedSnapshot.thread.status, "completed");
  assert.equal(refreshedSnapshot.events.at(-1)?.kind, "status");
});

test("getDelta returns appended events and authoritative summary", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-runtime-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const rolloutPath = path.join(workspace, "rollout.jsonl");
  await writeFile(
    rolloutPath,
    `${eventMsg("task_started", "2026-04-23T08:00:00.000Z")}\n`,
  );

  const row: ThreadRow = {
    id: "thread-2",
    rollout_path: rolloutPath,
    created_at_ms: 1,
    updated_at_ms: 2,
    source: "cli",
    cwd: workspace,
    title: "demo",
    cli_version: "0.123.0",
    first_user_message: "hello",
  };
  const runtime = new ThreadRuntime(row);
  const firstSnapshot = await runtime.getSnapshot();

  await appendFile(
    rolloutPath,
    `${eventMsg("task_complete", "2026-04-23T08:00:01.000Z")}\n`,
  );

  const delta = await runtime.getDelta(firstSnapshot.nextCursor);

  assert.equal(delta.thread.status, "completed");
  assert.equal(delta.events.length, 1);
  assert.equal(delta.events[0]?.kind, "status");
  assert.equal(delta.nextCursor, 2);
});
