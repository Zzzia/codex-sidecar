import {
  CircleAlert,
  TerminalSquare,
} from "lucide-react";
import type {
  ExplorationStepView,
  ToolRunView,
} from "@web/lib/turns";
import {
  explorationLabel,
  explorationMeta,
  explorationState,
  summarizeExplorationStep,
} from "./timelineHelpers";

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.max(16, Math.floor(maxLength * 0.6));
  const tail = Math.max(10, maxLength - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function toolDisplayName(tool: ToolRunView): string {
  if (tool.name === "exec_command") {
    return "Run";
  }
  return tool.name;
}

function toolBadgeText(tool: ToolRunView): string {
  if (tool.patchSummary) {
    return tool.patchSummary;
  }

  if (tool.result?.success === false) {
    return tool.result.exitCode != null ? `exit ${tool.result.exitCode}` : "异常";
  }

  if (tool.status === "failed") {
    return "异常";
  }

  if (tool.result?.exitCode != null && tool.result.exitCode !== 0) {
    return `exit ${tool.result.exitCode}`;
  }

  if (tool.result?.success === true && tool.name === "exec_command") {
    return "";
  }

  return tool.status === "completed" ? "" : tool.status ?? "";
}

export function ToolRunList({
  items,
  onInspect,
}: {
  items: ToolRunView[];
  onInspect: (tool: ToolRunView) => void;
}) {
  return (
    <div className="turn-tool-list">
      {items.map((tool) => {
        const hasError = tool.result?.success === false || tool.patchSuccess === false;
        const hasSuccess =
          tool.result?.success === true ||
          (tool.patchSuccess === true && tool.patchChanges.length > 0);
        const badgeText = toolBadgeText(tool);

        return (
          <button
            key={tool.id}
            className={`tool-run-row ${hasError ? "is-error" : hasSuccess ? "is-success" : ""}`}
            onClick={() => onInspect(tool)}
            title={`${tool.preview}\n点击查看详情`}
          >
            <span className="tool-run-icon">
              {hasError ? <CircleAlert size={14} /> : <TerminalSquare size={14} />}
            </span>
            <span className="tool-run-main">
              <span className="tool-run-name">{toolDisplayName(tool)}</span>
              <code className="tool-run-preview">
                {truncateMiddle(tool.preview, 110)}
              </code>
            </span>
            {badgeText ? <span className="tool-run-badge">{badgeText}</span> : null}
            <span className="tool-run-hint">查看详情</span>
          </button>
        );
      })}
    </div>
  );
}

export function ExplorationRunList({
  items,
  onInspect,
}: {
  items: ExplorationStepView[];
  onInspect: (step: ExplorationStepView) => void;
}) {
  return (
    <div className="turn-exploration-list">
      {items.map((step) => {
        const state = explorationState(step);
        const meta = explorationMeta(step);

        return (
          <button
            key={step.id}
            className={`exploration-row is-${state}`}
            onClick={() => onInspect(step)}
            title={summarizeExplorationStep(step)}
          >
            <span className="exploration-label">{explorationLabel(step)}</span>
            <span className="exploration-main">
              <code className="exploration-summary">
                {truncateMiddle(summarizeExplorationStep(step), 140)}
              </code>
              {meta ? <span className="exploration-meta">{meta}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
