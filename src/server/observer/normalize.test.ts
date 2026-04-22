import test from "node:test";
import assert from "node:assert/strict";
import {
  createThreadSummary,
  normalizeRecord,
  summarizeThreadText,
} from "./normalize.js";
import type { ThreadRow } from "./types.js";

const row: ThreadRow = {
  id: "thread-1",
  rollout_path: "/tmp/rollout.jsonl",
  created_at_ms: 1,
  updated_at_ms: 2,
  source: "cli",
  cwd: "/workspace/demo",
  title: "demo",
  cli_version: "0.122.0",
  first_user_message: "hello",
};

test("normalizeRecord extracts assistant markdown message and plan flag", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "<proposed_plan>\n# title\n</proposed_plan>",
          },
        ],
      },
    },
    {
      row,
      callNames: new Map(),
      status: "idle",
    },
    1,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "message");
  assert.equal(events[0]?.isPlan, true);
});

test("normalizeRecord does not mark plain proposed_plan mentions as plans", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "这里会把 `<proposed_plan>` 当作普通文本说明，不是真正的计划块。",
          },
        ],
      },
    },
    {
      row,
      callNames: new Map(),
      status: "idle",
    },
    1,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "message");
  assert.equal(events[0]?.isPlan, false);
});

test("normalizeRecord preserves parsed exec commands from exec_command_end", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call-1",
        command: ["rg", "-n", "needle", "src"],
        parsed_cmd: [
          {
            type: "search",
            cmd: "rg -n needle src",
            query: "needle",
            path: "src",
          },
          {
            type: "read",
            cmd: "sed -n '1,120p' src/demo.ts",
            name: "demo.ts",
            path: "/workspace/demo/src/demo.ts",
          },
        ],
        aggregated_output: "",
        stderr: "",
        exit_code: 0,
      },
    },
    {
      row,
      callNames: new Map([["call-1", "exec_command"]]),
      status: "running",
    },
    1,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "tool_result");
  if (events[0]?.kind !== "tool_result") {
    assert.fail("expected tool_result event");
  }
  assert.deepEqual(events[0].result.parsedCommands, [
    {
      type: "search",
      cmd: "rg -n needle src",
      query: "needle",
      path: "src",
    },
    {
      type: "read",
      cmd: "sed -n '1,120p' src/demo.ts",
      name: "demo.ts",
      path: "/workspace/demo/src/demo.ts",
    },
  ]);
});

test("normalizeRecord extracts patch changes from patch_apply_end", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        call_id: "call-1",
        success: true,
        changes: {
          "/workspace/demo/src/file.ts": {
            type: "update",
            unified_diff: "@@ -1 +1 @@\n-a\n+b",
          },
        },
      },
    },
    {
      row,
      callNames: new Map(),
      status: "running",
    },
    2,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "patch");
  if (events[0]?.kind !== "patch") {
    assert.fail("expected patch event");
  }
  assert.equal(events[0].changes[0]?.displayPath, "src/file.ts");
  assert.match(events[0].changes[0]?.unifiedDiff ?? "", /\+b/);
});

test("normalizeRecord synthesizes unified diff for added files", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        call_id: "call-2",
        success: true,
        changes: {
          "/workspace/demo/src/new.ts": {
            type: "add",
            content: "export const value = 1;\n",
          },
        },
      },
    },
    {
      row,
      callNames: new Map(),
      status: "running",
    },
    3,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "patch");
  if (events[0]?.kind !== "patch") {
    assert.fail("expected patch event");
  }
  assert.match(events[0].changes[0]?.unifiedDiff ?? "", /--- \/dev\/null/);
  assert.match(events[0].changes[0]?.unifiedDiff ?? "", /\+\+\+ b\/src\/new.ts/);
  assert.match(events[0].changes[0]?.unifiedDiff ?? "", /\+export const value = 1;/);
});

test("normalizeRecord ignores token_count and agent_message duplicates", () => {
  const metricEvents = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
      },
    },
    {
      row,
      callNames: new Map(),
      status: "running",
    },
    3,
  );

  const agentEvents = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "intermediate update",
      },
    },
    {
      row,
      callNames: new Map(),
      status: "running",
    },
    4,
  );

  assert.deepEqual(metricEvents, []);
  assert.deepEqual(agentEvents, []);
});

test("summarizeThreadText collapses whitespace and truncates long text", () => {
  const summary = summarizeThreadText(
    `第一行内容\n第二行内容 ${"很长".repeat(60)}`,
  );

  assert.ok(summary.length <= 100);
  assert.match(summary, /第一行内容 第二行内容/);
  assert.ok(summary.endsWith("…"));
});

test("createThreadSummary truncates title and first user message for sidebar payloads", () => {
  const summary = createThreadSummary({
    ...row,
    title: "",
    first_user_message: `  ${"这是一段很长的会话标题".repeat(12)}  `,
  });

  assert.ok(summary.title.length <= 100);
  assert.ok(summary.firstUserMessage.length <= 100);
  assert.ok(summary.title.endsWith("…"));
});
