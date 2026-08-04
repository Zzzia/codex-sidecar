import test from "node:test";
import assert from "node:assert/strict";
import type { TimelineEvent } from "@shared/types";
import { extractThreadProgress } from "./progress.js";

test("extractThreadProgress prefers latest update_plan tool call", () => {
  const events: TimelineEvent[] = [
    {
      id: "m1",
      ts: "2026-04-22T08:00:00.000Z",
      kind: "message",
      role: "assistant",
      text: "<proposed_plan>\n- 先看仓库\n- 再改代码\n</proposed_plan>",
      isPlan: true,
    },
    {
      id: "u1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "update_plan",
        argumentsText: JSON.stringify({
          explanation: "当前进度",
          plan: [
            { step: "先看仓库", status: "completed" },
            { step: "再改代码", status: "in_progress" },
            { step: "跑验证", status: "pending" },
          ],
        }),
        toolType: "function_call",
      },
    },
  ];

  const progress = extractThreadProgress(events);
  assert.ok(progress);
  assert.equal(progress?.source, "update_plan");
  assert.deepEqual(
    progress?.items.map((item) => item.status),
    ["completed", "in_progress", "pending"],
  );
});

test("extractThreadProgress ignores assistant proposed plans when update_plan is absent", () => {
  const events: TimelineEvent[] = [
    {
      id: "m1",
      ts: "2026-04-22T08:00:00.000Z",
      kind: "message",
      role: "assistant",
      text: "<proposed_plan>\n# 方案\n- 看日志\n- 改渲染\n</proposed_plan>",
      isPlan: true,
    },
  ];

  const progress = extractThreadProgress(events);
  assert.equal(progress, null);
});

test("extractThreadProgress completes in-progress steps after thread completion", () => {
  const events: TimelineEvent[] = [
    {
      id: "u1",
      ts: "2026-04-22T08:00:00.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "update_plan",
        argumentsText: JSON.stringify({
          plan: [
            { step: "先看仓库", status: "completed" },
            { step: "再改代码", status: "in_progress" },
          ],
        }),
        toolType: "function_call",
      },
    },
    {
      id: "s1",
      ts: "2026-04-22T08:00:05.000Z",
      kind: "status",
      status: "completed",
      title: "对话结束",
    },
  ];

  const progress = extractThreadProgress(events, "completed");
  assert.ok(progress);
  assert.deepEqual(
    progress?.items.map((item) => item.status),
    ["completed", "completed"],
  );
  assert.equal(progress?.ts, "2026-04-22T08:00:05.000Z");
});

test("extractThreadProgress ignores stale plans from previous turns", () => {
  const events: TimelineEvent[] = [
    {
      id: "user-1",
      ts: "2026-04-22T08:00:00.000Z",
      kind: "message",
      role: "user",
      text: "先修进度区",
      isPlan: false,
    },
    {
      id: "plan-1",
      ts: "2026-04-22T08:00:01.000Z",
      kind: "tool_call",
      callId: "call-1",
      tool: {
        name: "update_plan",
        argumentsText: JSON.stringify({
          plan: [{ step: "修进度区", status: "in_progress" }],
        }),
        toolType: "function_call",
      },
    },
    {
      id: "done-1",
      ts: "2026-04-22T08:00:02.000Z",
      kind: "status",
      status: "completed",
      title: "对话结束",
    },
    {
      id: "user-2",
      ts: "2026-04-22T08:01:00.000Z",
      kind: "message",
      role: "user",
      text: "再看一下侧栏",
      isPlan: false,
    },
    {
      id: "start-2",
      ts: "2026-04-22T08:01:01.000Z",
      kind: "status",
      status: "running",
      title: "对话开始",
    },
  ];

  const progress = extractThreadProgress(events, "running");
  assert.equal(progress, null);
});

test("extractThreadProgress parses tools.update_plan nested in code-mode exec", () => {
  const events: TimelineEvent[] = [
    {
      id: "exec-plan",
      ts: "2026-08-04T14:23:59.000Z",
      kind: "tool_call",
      callId: "call-exec-1",
      tool: {
        name: "exec",
        argumentsText: `const result = await tools.update_plan({
  plan: [
    { step: "完整读取四个 Skill 及本任务所需引用说明", status: "completed" },
    { step: "从备份提取当前节点职责、Prompt、变量引用和 DAG", status: "completed" },
    { step: "用临时流程原型模拟当前与候选 DAG 的成功、失败和返工路径", status: "completed" },
    { step: "结合领域模型、深模块设计和编码纪律给出推荐流程与节点 Prompt 结构", status: "in_progress" }
  ]
});
text(result);`,
        toolType: "custom_tool_call",
      },
    },
  ];

  const progress = extractThreadProgress(events, "running");
  assert.ok(progress);
  assert.equal(progress?.source, "update_plan");
  assert.equal(progress?.items.length, 4);
  assert.deepEqual(
    progress?.items.map((item) => item.status),
    ["completed", "completed", "completed", "in_progress"],
  );
  assert.equal(
    progress?.items[3]?.step,
    "结合领域模型、深模块设计和编码纪律给出推荐流程与节点 Prompt 结构",
  );
});

test("extractThreadProgress resolves plan variable references in code-mode exec", () => {
  const events: TimelineEvent[] = [
    {
      id: "exec-plan-ref",
      ts: "2026-08-04T14:16:29.000Z",
      kind: "tool_call",
      callId: "call-exec-2",
      tool: {
        name: "exec",
        argumentsText: `const plan = [
  { step: "梳理当前 UI", status: "completed" },
  { step: "修复画布空白", status: "in_progress" },
  { step: "浏览器验证", status: "pending" }
];
const res = await tools.update_plan({
  explanation: "后台 Agent 已开始工作",
  plan
});
text(res);`,
        toolType: "custom_tool_call",
      },
    },
  ];

  const progress = extractThreadProgress(events, "running");
  assert.ok(progress);
  assert.equal(progress?.explanation, "后台 Agent 已开始工作");
  assert.deepEqual(
    progress?.items.map((item) => item.step),
    ["梳理当前 UI", "修复画布空白", "浏览器验证"],
  );
  assert.deepEqual(
    progress?.items.map((item) => item.status),
    ["completed", "in_progress", "pending"],
  );
});
