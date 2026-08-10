import type { ParsedCommand } from "@shared/types";
import {
  extractShellCommandTexts,
  isExplorationCommand,
  isShellToolName,
  parseShellToolCommands,
} from "./commandSemantics";
import type {
  ExplorationStepView,
  ToolRunView,
  TurnBlock,
} from "./turnTypes";

/** Minimal turn surface for tool / exploration placement. */
export interface TurnToolHost {
  updatedAt: string;
  blocks: TurnBlock[];
  toolMap: Map<string, ToolRunView>;
}

function ensureExplorationBlock(turn: TurnToolHost): ExplorationStepView[] {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "exploration_runs") {
    return last.items;
  }

  const block: TurnBlock = {
    type: "exploration_runs",
    id: `exploration:${turn.blocks.length}`,
    items: [],
  };
  turn.blocks.push(block);
  return block.items;
}

function ensureToolBlock(turn: TurnToolHost): ToolRunView[] {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "tool_runs") {
    return last.items;
  }

  const block: TurnBlock = {
    type: "tool_runs",
    id: `tools:${turn.blocks.length}`,
    items: [],
  };
  turn.blocks.push(block);
  return block.items;
}

function resolveParsedCommands(
  toolName: string,
  commandText: string,
  parsedCommands: ParsedCommand[] | undefined,
  invocationText = "",
): ParsedCommand[] {
  if (!isShellToolName(toolName)) {
    return [];
  }

  if (parsedCommands && parsedCommands.length > 0) {
    return parsedCommands;
  }

  // Prefer real nested shell cmds from the invocation over display-only text.
  if (toolName === "exec" && invocationText) {
    const shellCommands = extractShellCommandTexts(toolName, invocationText);
    if (shellCommands.length > 0) {
      return parseShellToolCommands(toolName, shellCommands.join(" && "));
    }
    return [];
  }

  return commandText ? parseShellToolCommands(toolName, commandText) : [];
}

export function hydrateToolCommand(
  tool: ToolRunView,
  commandText: string,
  parsedCommands?: ParsedCommand[],
): void {
  if (commandText && tool.commandText !== commandText) {
    tool.commandText = commandText;
    if (isShellToolName(tool.name)) {
      tool.preview = commandText;
    }
  }

  tool.parsedCommands = resolveParsedCommands(
    tool.name,
    tool.commandText,
    parsedCommands,
    tool.invocationText,
  );
}

function removeToolRunFromToolBlocks(turn: TurnToolHost, tool: ToolRunView): void {
  for (const block of turn.blocks) {
    if (block.type !== "tool_runs") {
      continue;
    }

    const nextItems = block.items.filter((entry) => entry.id !== tool.id);
    if (nextItems.length !== block.items.length) {
      block.items.splice(0, block.items.length, ...nextItems);
      break;
    }
  }

  turn.blocks = turn.blocks.filter((block) => {
    if (block.type !== "tool_runs") {
      return true;
    }
    return block.items.length > 0;
  });
  tool.placement = null;
}

export function ensureToolRun(
  turn: TurnToolHost,
  callId: string,
  fallback: Partial<ToolRunView>,
): ToolRunView {
  const existing = turn.toolMap.get(callId);
  if (existing) {
    if (fallback.ts && !existing.ts) {
      existing.ts = fallback.ts;
    }
    if (fallback.name && existing.name === "tool") {
      existing.name = fallback.name;
    }
    if (fallback.invocationText && !existing.invocationText) {
      existing.invocationText = fallback.invocationText;
    }
    if (fallback.toolType && existing.toolType === "unknown") {
      existing.toolType = fallback.toolType;
    }
    if (fallback.status && !existing.status) {
      existing.status = fallback.status;
    }
    if (fallback.result) {
      existing.result = fallback.result;
    }
    hydrateToolCommand(
      existing,
      fallback.commandText ?? existing.commandText,
      fallback.parsedCommands,
    );
    return existing;
  }

  const next: ToolRunView = {
    callId,
    id: callId || `${fallback.name ?? "tool"}:${fallback.ts ?? turn.updatedAt}`,
    ts: fallback.ts ?? turn.updatedAt,
    name: fallback.name ?? "tool",
    preview: fallback.preview ?? fallback.name ?? "tool",
    invocationText: fallback.invocationText ?? "",
    commandText: fallback.commandText ?? "",
    parsedCommands: resolveParsedCommands(
      fallback.name ?? "tool",
      fallback.commandText ?? "",
      fallback.parsedCommands,
      fallback.invocationText ?? "",
    ),
    toolType: fallback.toolType ?? "unknown",
    status: fallback.status,
    result: fallback.result ?? null,
    patchSummary: fallback.patchSummary ?? null,
    patchSuccess: fallback.patchSuccess ?? null,
    patchChanges: fallback.patchChanges ?? [],
    placement: null,
  };

  turn.toolMap.set(callId, next);
  return next;
}

function isExplorationTool(tool: ToolRunView): boolean {
  return (
    isShellToolName(tool.name) &&
    tool.parsedCommands.length > 0 &&
    tool.parsedCommands.every(isExplorationCommand)
  );
}

function attachToolToExplorationStep(step: ExplorationStepView, tool: ToolRunView): void {
  if (!step.tools.some((entry) => entry.id === tool.id)) {
    step.tools.push(tool);
  }
}

function appendExplorationRun(turn: TurnToolHost, tool: ToolRunView): void {
  const items = ensureExplorationBlock(turn);
  for (const command of tool.parsedCommands) {
    if (!isExplorationCommand(command)) {
      continue;
    }

    const last = items[items.length - 1];
    if (command.type === "read" && last?.kind === "read") {
      if (!last.files.includes(command.name)) {
        last.files.push(command.name);
      }
      attachToolToExplorationStep(last, tool);
      continue;
    }

    if (command.type === "read") {
      items.push({
        kind: "read",
        id: `${tool.id}:read:${items.length}`,
        ts: tool.ts,
        files: [command.name],
        tools: [tool],
      });
      continue;
    }

    if (command.type === "search") {
      items.push({
        kind: "search",
        id: `${tool.id}:search:${items.length}`,
        ts: tool.ts,
        query: command.query,
        path: command.path,
        tools: [tool],
      });
      continue;
    }

    items.push({
      kind: "list",
      id: `${tool.id}:list:${items.length}`,
      ts: tool.ts,
      path: command.path,
      tools: [tool],
    });
  }
}

export function placeToolRun(turn: TurnToolHost, tool: ToolRunView): void {
  // Shell tools without a displayable summary stay pending until result arrives.
  if (
    isShellToolName(tool.name) &&
    !tool.commandText &&
    !tool.preview &&
    !tool.result
  ) {
    return;
  }

  if (isExplorationTool(tool)) {
    if (tool.placement === "exploration") {
      return;
    }
    if (tool.placement === "tool") {
      removeToolRunFromToolBlocks(turn, tool);
    }
    appendExplorationRun(turn, tool);
    tool.placement = "exploration";
    return;
  }

  if (tool.placement) {
    return;
  }

  ensureToolBlock(turn).push(tool);
  tool.placement = "tool";
}

function findExecToolByProcessId(
  turn: TurnToolHost,
  processId: string,
): ToolRunView | null {
  for (const tool of turn.toolMap.values()) {
    if (isShellToolName(tool.name) && tool.result?.processId === processId) {
      return tool;
    }
  }

  return null;
}

function appendOutputText(currentText: string, nextText: string): string {
  if (!currentText) {
    return nextText;
  }
  if (!nextText) {
    return currentText;
  }
  return `${currentText}${nextText}`;
}

export function mergeWriteStdinResultIntoExec(
  turn: TurnToolHost,
  result: NonNullable<ToolRunView["result"]>,
): void {
  if (!result.processId) {
    return;
  }

  const tool = findExecToolByProcessId(turn, result.processId);
  if (!tool?.result) {
    return;
  }

  tool.result = {
    ...tool.result,
    success: result.success ?? tool.result.success,
    exitCode: result.exitCode ?? tool.result.exitCode,
    outputText: appendOutputText(tool.result.outputText, result.outputText),
    stderrText: appendOutputText(tool.result.stderrText, result.stderrText),
    processId: result.exitCode == null ? result.processId : undefined,
    wallTimeSeconds: result.wallTimeSeconds ?? tool.result.wallTimeSeconds,
    outputLineCount: result.outputLineCount ?? tool.result.outputLineCount,
    raw: {
      initial: tool.result.raw,
      latest: result.raw,
    },
  };
}
