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

test("extractThreadProgress falls back to assistant proposed plan when update_plan is absent", () => {
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
  assert.ok(progress);
  assert.equal(progress?.source, "assistant_plan");
  assert.deepEqual(
    progress?.items.map((item) => item.step),
    ["看日志", "改渲染"],
  );
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
