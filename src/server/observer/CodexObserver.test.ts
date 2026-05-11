import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexObserver } from "./CodexObserver.js";

const execFileAsync = promisify(execFile);

function eventMsg(type: string, timestamp: string): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type },
  });
}

async function runSqlite(dbPath: string, sql: string): Promise<void> {
  await execFileAsync("sqlite3", [dbPath, sql]);
}

test("listActiveThreads only returns refreshed running CLI threads", async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-observer-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const dbPath = path.join(workspace, "state.sqlite");
  const runningRollout = path.join(workspace, "running.jsonl");
  const completedRollout = path.join(workspace, "completed.jsonl");

  await writeFile(
    runningRollout,
    `${eventMsg("task_started", "2026-05-11T08:00:00.000Z")}\n`,
  );
  await writeFile(
    completedRollout,
    [
      eventMsg("task_started", "2026-05-11T07:00:00.000Z"),
      eventMsg("task_complete", "2026-05-11T07:00:01.000Z"),
    ].join("\n") + "\n",
  );

  await runSqlite(
    dbPath,
    `
      create table threads (
        id text primary key,
        rollout_path text not null,
        created_at_ms integer,
        updated_at_ms integer,
        created_at integer,
        updated_at integer,
        source text not null,
        cwd text not null,
        title text,
        cli_version text,
        first_user_message text,
        archived integer not null default 0
      );

      insert into threads
        (id, rollout_path, created_at_ms, updated_at_ms, source, cwd, title, cli_version, first_user_message, archived)
      values
        ('running-thread', '${runningRollout}', 1, 30, 'cli', '${workspace}', 'running demo', '0.1.0', 'run it', 0),
        ('completed-thread', '${completedRollout}', 1, 40, 'cli', '${workspace}', 'completed demo', '0.1.0', 'finish it', 0),
        ('non-cli-thread', '${runningRollout}', 1, 50, 'api', '${workspace}', 'api demo', '0.1.0', 'ignore it', 0);
    `,
  );

  const observer = new CodexObserver(dbPath);
  const activeThreads = await observer.listActiveThreads();

  assert.deepEqual(
    activeThreads.map((thread) => thread.id),
    ["running-thread"],
  );
  assert.equal(activeThreads[0]?.status, "running");
});
