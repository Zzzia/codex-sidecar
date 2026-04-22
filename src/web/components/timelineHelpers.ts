import type { ExplorationStepView, ToolRunView } from "@web/lib/turns";

export function formatTimestamp(ts: string): string {
  if (!ts) {
    return "";
  }
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function summarizeExplorationStep(step: ExplorationStepView): string {
  if (step.kind === "read") {
    return step.files.join(", ");
  }

  if (step.kind === "search") {
    if (step.query && step.path) {
      return `${step.query} · ${step.path}`;
    }
    return step.query ?? step.path ?? "搜索";
  }

  return step.path ?? "当前目录";
}

export function explorationLabel(step: ExplorationStepView): string {
  if (step.kind === "read") {
    return "读取";
  }
  if (step.kind === "search") {
    return "搜索";
  }
  return "列目录";
}

export function toolRunState(tool: ToolRunView): "running" | "error" | "success" | "idle" {
  if (tool.result?.success === false || tool.patchSuccess === false) {
    return "error";
  }
  if (tool.result || tool.patchSuccess === true) {
    return "success";
  }
  if (tool.status === "completed") {
    return "success";
  }
  if (tool.status === "failed") {
    return "error";
  }
  return "running";
}

export function explorationState(
  step: ExplorationStepView,
): "running" | "error" | "success" | "idle" {
  const states = step.tools.map(toolRunState);
  if (states.includes("error")) {
    return "error";
  }
  if (states.includes("running")) {
    return "running";
  }
  if (states.every((state) => state === "success")) {
    return "success";
  }
  return "idle";
}

export function explorationMeta(step: ExplorationStepView): string {
  if (step.tools.length > 1) {
    return `${step.tools.length} 条命令`;
  }

  return explorationState(step) === "running" ? "执行中" : "";
}
