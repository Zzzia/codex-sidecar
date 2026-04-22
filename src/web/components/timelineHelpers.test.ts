import test from "node:test";
import assert from "node:assert/strict";
import { explorationMeta, shouldShowPatchBackTop } from "./timelineHelpers.js";
import type { ExplorationStepView, ToolRunView } from "@web/lib/turns";

function createTool(overrides: Partial<ToolRunView> = {}): ToolRunView {
  return {
    callId: "call-1",
    id: "tool-1",
    ts: "2026-04-22T08:00:00.000Z",
    name: "exec_command",
    preview: "rg needle src",
    invocationText: "",
    commandText: "rg needle src",
    parsedCommands: [],
    toolType: "function_call",
    result: null,
    patchSummary: null,
    patchSuccess: null,
    patchChanges: [],
    placement: "exploration",
    ...overrides,
  };
}

test("explorationMeta hides explicit error text for failed steps", () => {
  const step: ExplorationStepView = {
    kind: "read",
    id: "step-1",
    ts: "2026-04-22T08:00:00.000Z",
    files: ["src/demo.ts"],
    tools: [createTool({ result: { toolType: "exec_command_end", title: "", success: false, exitCode: 1, outputText: "", stderrText: "", raw: null } })],
  };

  assert.equal(explorationMeta(step), "");
});

test("explorationMeta prefers command count for grouped exploration", () => {
  const step: ExplorationStepView = {
    kind: "search",
    id: "step-2",
    ts: "2026-04-22T08:00:00.000Z",
    query: "needle",
    path: "src",
    tools: [createTool(), createTool({ id: "tool-2", callId: "call-2" })],
  };

  assert.equal(explorationMeta(step), "2 条命令");
});

test("explorationMeta keeps running hint for a single active step", () => {
  const step: ExplorationStepView = {
    kind: "list",
    id: "step-3",
    ts: "2026-04-22T08:00:00.000Z",
    path: "src",
    tools: [createTool()],
  };

  assert.equal(explorationMeta(step), "执行中");
});

test("shouldShowPatchBackTop only reacts to diff content taller than viewport", () => {
  assert.equal(shouldShowPatchBackTop(1600, 900), true);
  assert.equal(shouldShowPatchBackTop(900, 900), false);
  assert.equal(shouldShowPatchBackTop(820, 900), false);
});

test("shouldShowPatchBackTop rejects invalid heights", () => {
  assert.equal(shouldShowPatchBackTop(0, 900), false);
  assert.equal(shouldShowPatchBackTop(Number.NaN, 900), false);
  assert.equal(shouldShowPatchBackTop(1200, Number.POSITIVE_INFINITY), false);
});
