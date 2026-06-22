import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlinePatchRun, ToolDetailsModal } from "./TimelineInspectors.js";
import type { PatchRunView, ToolRunView } from "@web/lib/turns";

test("InlinePatchRun renders every patch file expanded by default", () => {
  const item: PatchRunView = {
    callId: "call-1",
    id: "patch-1",
    ts: "2026-04-22T08:00:00.000Z",
    invocationText: "",
    summary: "Code changes",
    success: true,
    changes: [
      {
        path: "/workspace/demo/src/a.ts",
        displayPath: "src/a.ts",
        changeType: "update",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
      {
        path: "/workspace/demo/src/b.ts",
        displayPath: "src/b.ts",
        changeType: "update",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+newer",
      },
    ],
  };

  const markup = renderToStaticMarkup(
    React.createElement(InlinePatchRun, { item, localFileContext: null }),
  );
  const openCount = (markup.match(/<details class=\"inline-patch-file\" open=\"\"/g) ?? []).length;

  assert.equal(openCount, 2);
});

test("InlinePatchRun shows file preview controls when file context is available", () => {
  const item: PatchRunView = {
    callId: "call-1",
    id: "patch-1",
    ts: "2026-04-22T08:00:00.000Z",
    invocationText: "",
    summary: "Code changes",
    success: true,
    changes: [
      {
        path: "/workspace/demo/src/a.ts",
        displayPath: "src/a.ts",
        changeType: "update",
        unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ],
  };

  const markup = renderToStaticMarkup(
    React.createElement(InlinePatchRun, {
      item,
      localFileContext: { threadId: "thread-1", cwd: "/workspace/demo" },
    }),
  );

  assert.match(markup, /class="patch-preview-button"/);
});

test("InlinePatchRun hides file preview controls for deleted files", () => {
  const item: PatchRunView = {
    callId: "call-1",
    id: "patch-1",
    ts: "2026-04-22T08:00:00.000Z",
    invocationText: "",
    summary: "Code changes",
    success: true,
    changes: [
      {
        path: "/workspace/demo/src/a.ts",
        displayPath: "src/a.ts",
        changeType: "delete",
        unifiedDiff: "@@ -1,1 +0,0 @@\n-old",
      },
    ],
  };

  const markup = renderToStaticMarkup(
    React.createElement(InlinePatchRun, {
      item,
      localFileContext: { threadId: "thread-1", cwd: "/workspace/demo" },
    }),
  );

  assert.doesNotMatch(markup, /class="patch-preview-button"/);
});

test("ToolDetailsModal renders command output text", () => {
  const tool: ToolRunView = {
    callId: "call-1",
    id: "call-1",
    ts: "2026-05-08T06:20:22.655Z",
    name: "exec_command",
    preview: "pwd",
    invocationText: "{\"cmd\":\"pwd\"}",
    commandText: "pwd",
    parsedCommands: [],
    toolType: "function_call",
    status: "completed",
    result: {
      toolType: "function_call_output",
      title: "exec_command",
      success: true,
      exitCode: 0,
      outputText: "/workspace/demo\n",
      stderrText: "",
      raw: {
        rawOutput: "Chunk ID: abc123\nWall time: 0.0000 seconds\nOutput:\n/workspace/demo\n",
      },
      wallTimeSeconds: 0,
    },
    patchSummary: null,
    patchSuccess: null,
    patchChanges: [],
    placement: "tool",
  };

  const markup = renderToStaticMarkup(
    React.createElement(ToolDetailsModal, {
      tool,
      localFileContext: null,
      onClose: () => undefined,
    }),
  );

  assert.match(markup, />Tool output</);
  assert.match(markup, /\/workspace\/demo/);
  assert.doesNotMatch(markup, /Chunk ID/);
});

test("ToolDetailsModal renders running command state without fake output", () => {
  const tool: ToolRunView = {
    callId: "call-1",
    id: "call-1",
    ts: "2026-05-19T09:00:00.000Z",
    name: "exec_command",
    preview: "sleep 10",
    invocationText: "{\"cmd\":\"sleep 10\"}",
    commandText: "sleep 10",
    parsedCommands: [],
    toolType: "function_call",
    status: "completed",
    result: {
      toolType: "function_call_output",
      title: "exec_command",
      success: null,
      exitCode: null,
      outputText: "",
      stderrText: "",
      raw: {
        rawOutput:
          "Chunk ID: 09c1e0\nWall time: 1.0006 seconds\nProcess running with session ID 30947\nOutput:\n",
      },
      processId: "30947",
      wallTimeSeconds: 1.0006,
    },
    patchSummary: null,
    patchSuccess: null,
    patchChanges: [],
    placement: "tool",
  };

  const markup = renderToStaticMarkup(
    React.createElement(ToolDetailsModal, {
      tool,
      localFileContext: null,
      onClose: () => undefined,
    }),
  );

  assert.match(markup, />Execution state</);
  assert.match(markup, /Running in background · session 30947/);
  assert.doesNotMatch(markup, />Tool output</);
});
