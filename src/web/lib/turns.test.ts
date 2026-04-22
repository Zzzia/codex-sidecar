import test from "node:test";
import assert from "node:assert/strict";
import type { TimelineEvent } from "@shared/types";
import { buildTurnCards, resolveTurnCardStatuses } from "./turns.js";

test("buildTurnCards merges one round into a single card", () => {
  const events: TimelineEvent[] = [
    {
      id: "s1",
      ts: "2026-04-22T08:00:00.000Z",
      kind: "status",
      status: "running",
      title: "对话开始",
    },
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "帮我看一下方案",
      isPlan: false,
    },
    {
      id: "a1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "message",
      role: "assistant",
      text: "先看仓库。",
      isPlan: false,
    },
    {
      id: "a2",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "message",
      role: "assistant",
      text: "再看实现。",
      isPlan: false,
    },
    {
      id: "c1",
      ts: "2026-04-22T08:00:04.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "exec_command",
        argumentsText: "{\"cmd\":\"pwd\"}",
        toolType: "function_call",
      },
    },
    {
      id: "r1",
      ts: "2026-04-22T08:00:05.000Z",
      kind: "tool_result",
      callId: "call-1",
      name: "exec_command",
      result: {
        toolType: "exec_command_end",
        title: "exec_command",
        success: true,
        exitCode: 0,
        outputText: "/tmp\n",
        stderrText: "",
        raw: {},
      },
    },
    {
      id: "s2",
      ts: "2026-04-22T08:00:06.000Z",
      kind: "status",
      status: "completed",
      title: "对话结束",
    },
  ];

  const cards = buildTurnCards(events);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.userText, "帮我看一下方案");
  assert.equal(cards[0]?.startedAt, "2026-04-22T08:00:01.000Z");
  assert.equal(cards[0]?.status, "completed");
  assert.equal(cards[0]?.statusTitle, "对话开始");
  assert.equal(cards[0]?.blocks.length, 2);
  assert.equal(cards[0]?.blocks[0]?.type, "assistant_markdown");
  if (cards[0]?.blocks[0]?.type !== "assistant_markdown") {
    assert.fail("expected markdown block");
  }
  assert.match(cards[0].blocks[0].text, /先看仓库。\n\n再看实现。/);
  assert.equal(cards[0]?.blocks[1]?.type, "tool_runs");
});

test("buildTurnCards keeps patch data in a dedicated patch block", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "改一下这个文件",
      isPlan: false,
    },
    {
      id: "c1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "tool_call",
      callId: "call-2",
      tool: {
        name: "apply_patch",
        argumentsText: "*** Begin Patch\n*** Update File: /tmp/demo.ts\n*** End Patch",
        toolType: "custom_tool_call",
      },
    },
    {
      id: "p1",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "patch",
      callId: "call-2",
      success: true,
      summary: "已更新 1 个文件",
      changes: [
        {
          path: "/tmp/demo.ts",
          displayPath: "demo.ts",
          changeType: "update",
          unifiedDiff: "@@ -1 +1 @@\n-a\n+b",
        },
      ],
    },
  ];

  const cards = buildTurnCards(events);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.blocks[0]?.type, "patch_runs");
  if (cards[0]?.blocks[0]?.type !== "patch_runs") {
    assert.fail("expected patch block");
  }
  assert.equal(cards[0].blocks[0].items[0]?.changes.length, 1);
  assert.equal(cards[0].blocks[0].items[0]?.summary, "已更新 1 个文件");
});

test("buildTurnCards coalesces exploratory exec commands into one exploration block", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "先搜再读文件",
      isPlan: false,
    },
    {
      id: "c1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "exec_command",
        argumentsText:
          "{\"cmd\":\"rg -n \\\"ToolRunView\\\" src/web/lib && sed -n '1,120p' src/web/lib/turns.ts\"}",
        toolType: "function_call",
      },
    },
    {
      id: "c2",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "tool_call",
      callId: "call-2",
      tool: {
        name: "exec_command",
        argumentsText:
          "{\"cmd\":\"sed -n '1,120p' src/web/components/Timeline.tsx\"}",
        toolType: "function_call",
      },
    },
  ];

  const cards = buildTurnCards(events);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.blocks[0]?.type, "exploration_runs");
  if (cards[0]?.blocks[0]?.type !== "exploration_runs") {
    assert.fail("expected exploration block");
  }

  assert.equal(cards[0].blocks[0].items.length, 2);
  assert.equal(cards[0].blocks[0].items[0]?.kind, "search");
  assert.equal(cards[0].blocks[0].items[1]?.kind, "read");
  if (cards[0].blocks[0].items[1]?.kind !== "read") {
    assert.fail("expected read step");
  }
  assert.deepEqual(cards[0].blocks[0].items[1].files, ["turns.ts", "Timeline.tsx"]);
  assert.equal(cards[0].blocks[0].items[1].tools.length, 2);
});

test("buildTurnCards reclassifies exec_command into exploration when parsed commands arrive in result", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "看看这个实现",
      isPlan: false,
    },
    {
      id: "c1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "exec_command",
        argumentsText: "{\"cmd\":\"unknown-wrapper --payload demo\"}",
        toolType: "function_call",
      },
    },
    {
      id: "r1",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "tool_result",
      callId: "call-1",
      name: "exec_command",
      result: {
        toolType: "exec_command_end",
        title: "exec_command",
        success: true,
        exitCode: 0,
        outputText: "",
        stderrText: "",
        parsedCommands: [
          {
            type: "read",
            cmd: "sed -n '1,120p' src/demo.ts",
            name: "demo.ts",
            path: "/tmp/src/demo.ts",
          },
        ],
        raw: {},
      },
    },
  ];

  const cards = buildTurnCards(events);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.blocks.length, 1);
  assert.equal(cards[0]?.blocks[0]?.type, "exploration_runs");
  if (cards[0]?.blocks[0]?.type !== "exploration_runs") {
    assert.fail("expected exploration block");
  }
  assert.equal(cards[0].blocks[0].items[0]?.kind, "read");
});

test("buildTurnCards keeps start title when task_started status is missing", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "看一下最新结果",
      isPlan: false,
    },
    {
      id: "a1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "message",
      role: "assistant",
      text: "先整理上下文。",
      isPlan: false,
    },
    {
      id: "s1",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "status",
      status: "completed",
      title: "对话结束",
    },
  ];

  const cards = buildTurnCards(events);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.status, "completed");
  assert.equal(cards[0]?.statusTitle, "对话开始");
});

test("buildTurnCards skips update_plan and assistant plan content in timeline body", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "继续",
      isPlan: false,
    },
    {
      id: "m1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "message",
      role: "assistant",
      text: "<proposed_plan>\n- 第一步\n</proposed_plan>",
      isPlan: true,
    },
    {
      id: "c1",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "update_plan",
        argumentsText: JSON.stringify({
          plan: [{ step: "第一步", status: "in_progress" }],
        }),
        toolType: "function_call",
      },
    },
    {
      id: "m2",
      ts: "2026-04-22T08:00:04.000Z",
      kind: "message",
      role: "assistant",
      text: "正文内容",
      isPlan: false,
    },
  ];

  const cards = buildTurnCards(events);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.blocks.length, 1);
  assert.equal(cards[0]?.blocks[0]?.type, "assistant_markdown");
});

test("buildTurnCards filters write_stdin tool events", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "继续",
      isPlan: false,
    },
    {
      id: "c1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "write_stdin",
        argumentsText: "{\"chars\":\"\\n\"}",
        toolType: "function_call",
      },
    },
    {
      id: "r1",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "tool_result",
      callId: "call-1",
      name: "write_stdin",
      result: {
        toolType: "function_call_output",
        title: "write_stdin",
        success: true,
        exitCode: 0,
        outputText: "",
        stderrText: "",
        raw: {},
      },
    },
    {
      id: "m1",
      ts: "2026-04-22T08:00:04.000Z",
      kind: "message",
      role: "assistant",
      text: "只保留正文。",
      isPlan: false,
    },
  ];

  const cards = buildTurnCards(events);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.blocks.length, 1);
  assert.equal(cards[0]?.blocks[0]?.type, "assistant_markdown");
});

test("buildTurnCards splits rounds when a new running status appears after completion", () => {
  const events: TimelineEvent[] = [
    {
      id: "s1",
      ts: "2026-04-22T08:00:00.000Z",
      kind: "status",
      status: "running",
      title: "对话开始",
    },
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "第一轮",
      isPlan: false,
    },
    {
      id: "a1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "message",
      role: "assistant",
      text: "第一轮结果",
      isPlan: false,
    },
    {
      id: "s2",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "status",
      status: "completed",
      title: "对话结束",
    },
    {
      id: "s3",
      ts: "2026-04-22T08:00:04.000Z",
      kind: "status",
      status: "running",
      title: "对话开始",
    },
    {
      id: "u2",
      ts: "2026-04-22T08:00:05.000Z",
      kind: "message",
      role: "user",
      text: "第二轮",
      isPlan: false,
    },
  ];

  const cards = buildTurnCards(events);
  assert.equal(cards.length, 2);
  assert.equal(cards[0]?.status, "completed");
  assert.equal(cards[0]?.statusTitle, "对话开始");
  assert.equal(cards[1]?.status, "running");
  assert.equal(cards[1]?.statusTitle, "对话开始");
});

test("resolveTurnCardStatuses applies thread completion to a trailing running turn", () => {
  const cards = buildTurnCards([
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "继续执行",
      isPlan: false,
    },
    {
      id: "a1",
      ts: "2026-04-22T08:00:03.000Z",
      kind: "message",
      role: "assistant",
      text: "处理中",
      isPlan: false,
    },
  ]);

  const resolved = resolveTurnCardStatuses(cards, "completed");
  assert.equal(resolved[0]?.status, "completed");
});

test("resolveTurnCardStatuses keeps explicit turn terminal status", () => {
  const cards = buildTurnCards([
    {
      id: "u1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "message",
      role: "user",
      text: "继续执行",
      isPlan: false,
    },
    {
      id: "s1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "status",
      status: "error",
      title: "执行异常",
    },
  ]);

  const resolved = resolveTurnCardStatuses(cards, "completed");
  assert.equal(resolved[0]?.status, "error");
});
