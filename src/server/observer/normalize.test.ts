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
  if (events[0]?.kind !== "message") {
    assert.fail("expected message event");
  }
  assert.equal(events[0].text, "# title\n");
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
            text:
              "这里会把 `<proposed_plan>` 和 `</proposed_plan>` 当作普通文本说明，" +
              "不是真正的计划块。",
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

test("normalizeRecord splits assistant proposed_plan blocks from visible text", () => {
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
            text: "正文前\n<proposed_plan>\n- 第一步\n</proposed_plan>\n正文后",
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

  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.kind === "message" && event.isPlan),
    [false, true, false],
  );
  assert.deepEqual(
    events.map((event) => (event.kind === "message" ? event.text : "")),
    ["正文前\n", "- 第一步\n", "正文后"],
  );
});

test("normalizeRecord strips hidden memory citation blocks from assistant messages", () => {
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
            text:
              "前文 <oai-mem-citation><citation_entries>\n" +
              "MEMORY.md:214-214|note=[confirmed current cwd netcheck context]\n" +
              "</citation_entries>\n<rollout_ids>\n" +
              "019dd75a-cc97-7bf1-bc3d-12e6a958e76f\n" +
              "</rollout_ids></oai-mem-citation> 后文",
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
  if (events[0]?.kind !== "message") {
    assert.fail("expected message event");
  }
  assert.equal(events[0].text, "前文  后文");
  assert.equal(events[0].isPlan, false);
});

test("normalizeRecord drops citation-only assistant messages", () => {
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
            text: "<oai-mem-citation>MEMORY.md:1-1|note=[x]</oai-mem-citation>",
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

  assert.deepEqual(events, []);
});

test("normalizeRecord strips unterminated memory citation blocks at end of message", () => {
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
            text: "可见内容<oai-mem-citation><citation_entries>\nMEMORY.md:1-1|note=[x]",
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
  if (events[0]?.kind !== "message") {
    assert.fail("expected message event");
  }
  assert.equal(events[0].text, "可见内容");
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

test("normalizeRecord preserves plain exec command output from function_call_output", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-05-08T06:20:22.655Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output:
          "Chunk ID: abc123\n" +
          "Wall time: 0.0000 seconds\n" +
          "Process exited with code 0\n" +
          "Output:\n" +
          "hello from shell\n",
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
  assert.equal(events[0].name, "exec_command");
  assert.equal(events[0].result.exitCode, 0);
  assert.equal(events[0].result.success, true);
  assert.equal(events[0].result.outputText, "hello from shell\n");
  assert.equal(events[0].result.wallTimeSeconds, 0);
});

test("normalizeRecord strips running exec metadata while preserving process state", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-05-19T09:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-running",
        output:
          "Chunk ID: 09c1e0\n" +
          "Wall time: 1.0006 seconds\n" +
          "Process running with session ID 30947\n" +
          "Original token count: 0\n" +
          "Output:\n",
      },
    },
    {
      row,
      callNames: new Map([["call-running", "exec_command"]]),
      status: "running",
    },
    1,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "tool_result");
  if (events[0]?.kind !== "tool_result") {
    assert.fail("expected tool_result event");
  }
  assert.equal(events[0].result.outputText, "");
  assert.equal(events[0].result.exitCode, null);
  assert.equal(events[0].result.success, null);
  assert.equal(events[0].result.processId, "30947");
  assert.equal(events[0].result.wallTimeSeconds, 1.0006);
});

test("normalizeRecord reads structured exec command function output", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-05-19T09:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-json",
        output: JSON.stringify({
          wall_time_seconds: 0.25,
          exit_code: 7,
          output: "json output\n",
        }),
      },
    },
    {
      row,
      callNames: new Map([["call-json", "exec_command"]]),
      status: "running",
    },
    1,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "tool_result");
  if (events[0]?.kind !== "tool_result") {
    assert.fail("expected tool_result event");
  }
  assert.equal(events[0].result.outputText, "json output\n");
  assert.equal(events[0].result.exitCode, 7);
  assert.equal(events[0].result.success, false);
  assert.equal(events[0].result.wallTimeSeconds, 0.25);
});

test("normalizeRecord attaches write_stdin output to its session id", () => {
  const context = {
    row,
    callNames: new Map<string, string>(),
    callArguments: new Map<string, string>(),
    status: "running" as const,
  };

  normalizeRecord(
    {
      timestamp: "2026-05-19T09:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "write_stdin",
        call_id: "call-stdin",
        arguments: JSON.stringify({ session_id: 30947, chars: "" }),
      },
    },
    context,
    1,
  );

  const events = normalizeRecord(
    {
      timestamp: "2026-05-19T09:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-stdin",
        output:
          "Chunk ID: c027f9\n" +
          "Wall time: 4.0395 seconds\n" +
          "Process exited with code 0\n" +
          "Original token count: 100\n" +
          "Output:\n" +
          "done\n",
      },
    },
    context,
    2,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "tool_result");
  if (events[0]?.kind !== "tool_result") {
    assert.fail("expected tool_result event");
  }
  assert.equal(events[0].name, "write_stdin");
  assert.equal(events[0].result.outputText, "done\n");
  assert.equal(events[0].result.exitCode, 0);
  assert.equal(events[0].result.processId, "30947");
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

test("normalizeRecord exposes context compaction checkpoints without payload text", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:01.000Z",
      type: "compacted",
      payload: {
        message: "hidden summary",
        replacement_history: [
          { type: "message", role: "user", content: [] },
          { type: "context_compaction", encrypted_content: "encrypted" },
        ],
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
  assert.equal(events[0]?.kind, "compaction");
  if (events[0]?.kind !== "compaction") {
    assert.fail("expected compaction event");
  }
  assert.equal(events[0].state, "running");
  assert.equal(events[0].replacementItemCount, 2);
  assert.doesNotMatch(events[0].detail ?? "", /hidden summary|encrypted/);
});

test("normalizeRecord marks context_compacted as completion", () => {
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "context_compacted",
      },
    },
    {
      row,
      callNames: new Map(),
      status: "running",
    },
    4,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "compaction");
  if (events[0]?.kind !== "compaction") {
    assert.fail("expected compaction event");
  }
  assert.equal(events[0].state, "completed");
  assert.equal(events[0].title, "上下文压缩完成");
});

test("normalizeRecord treats turn_aborted as a terminal non-active status", () => {
  const context = {
    row,
    callNames: new Map<string, string>(),
    status: "running" as const,
  };
  const events = normalizeRecord(
    {
      timestamp: "2026-04-22T08:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "turn_aborted",
        reason: "interrupted",
      },
    },
    context,
    5,
  );

  assert.equal(context.status, "completed");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "status");
  if (events[0]?.kind !== "status") {
    assert.fail("expected status event");
  }
  assert.equal(events[0].status, "completed");
  assert.equal(events[0].title, "对话中断");
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
  assert.equal(summary.contextWindowUsage, null);
});
