import type {
  ParsedCommand,
  ThreadStatus,
  TimelineEvent,
} from "@shared/types";
import {
  extractExecCommandText,
  isExplorationCommand,
  parseExecCommand,
} from "./commandSemantics";
import { commandTextFromResult, toolPreview } from "./toolPresentation";
import type {
  ExplorationStepView,
  PatchRunView,
  ToolRunView,
  TurnBlock,
  TurnCardView,
} from "./turnTypes";
export type {
  ExplorationStepView,
  PatchRunView,
  ToolRunView,
  TurnBlock,
  TurnCardView,
} from "./turnTypes";

interface MutableTurn {
  id: string;
  userText: string;
  startedAt: string;
  updatedAt: string;
  status: ThreadStatus;
  statusTitle: string;
  blocks: TurnBlock[];
  toolMap: Map<string, ToolRunView>;
  patchMap: Map<string, PatchRunView>;
}

function createTurn(seedTs: string, status: ThreadStatus, title: string): MutableTurn {
  return {
    id: `turn:${seedTs}`,
    userText: "",
    startedAt: seedTs,
    updatedAt: seedTs,
    status,
    statusTitle: title,
    blocks: [],
    toolMap: new Map(),
    patchMap: new Map(),
  };
}

function ensureExplorationBlock(turn: MutableTurn): ExplorationStepView[] {
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

function ensureToolBlock(turn: MutableTurn): ToolRunView[] {
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

function ensurePatchBlock(turn: MutableTurn): PatchRunView[] {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "patch_runs") {
    return last.items;
  }

  const block: TurnBlock = {
    type: "patch_runs",
    id: `patches:${turn.blocks.length}`,
    items: [],
  };
  turn.blocks.push(block);
  return block.items;
}

function resolveParsedCommands(
  toolName: string,
  commandText: string,
  parsedCommands: ParsedCommand[] | undefined,
): ParsedCommand[] {
  if (toolName !== "exec_command") {
    return [];
  }

  if (parsedCommands && parsedCommands.length > 0) {
    return parsedCommands;
  }

  return commandText ? parseExecCommand(commandText) : [];
}

function hydrateToolCommand(
  tool: ToolRunView,
  commandText: string,
  parsedCommands?: ParsedCommand[],
): void {
  if (commandText && tool.commandText !== commandText) {
    tool.commandText = commandText;
    if (tool.name === "exec_command") {
      tool.preview = commandText;
    }
  }

  tool.parsedCommands = resolveParsedCommands(
    tool.name,
    tool.commandText,
    parsedCommands,
  );
}

function removeToolRunFromToolBlocks(turn: MutableTurn, tool: ToolRunView): void {
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

function ensureToolRun(
  turn: MutableTurn,
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

function ensurePatchRun(
  turn: MutableTurn,
  callId: string,
  fallback: Partial<PatchRunView>,
): PatchRunView {
  const existing = turn.patchMap.get(callId);
  if (existing) {
    return existing;
  }

  const next: PatchRunView = {
    callId,
    id: callId || `${fallback.ts ?? turn.updatedAt}:patch`,
    ts: fallback.ts ?? turn.updatedAt,
    invocationText: fallback.invocationText ?? "",
    summary: fallback.summary ?? "代码修改",
    success: fallback.success ?? true,
    changes: fallback.changes ?? [],
  };

  ensurePatchBlock(turn).push(next);
  turn.patchMap.set(callId, next);
  return next;
}

function isExplorationTool(tool: ToolRunView): boolean {
  return (
    tool.name === "exec_command" &&
    tool.parsedCommands.length > 0 &&
    tool.parsedCommands.every(isExplorationCommand)
  );
}

function attachToolToExplorationStep(step: ExplorationStepView, tool: ToolRunView): void {
  if (!step.tools.some((entry) => entry.id === tool.id)) {
    step.tools.push(tool);
  }
}

function appendExplorationRun(turn: MutableTurn, tool: ToolRunView): void {
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

function placeToolRun(turn: MutableTurn, tool: ToolRunView): void {
  if (tool.name === "exec_command" && !tool.commandText && !tool.result) {
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

function appendMarkdownBlock(turn: MutableTurn, text: string): void {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "assistant_markdown") {
    last.text = `${last.text}\n\n${text}`.trim();
    return;
  }

  turn.blocks.push({
    type: "assistant_markdown",
    id: `assistant_markdown:${turn.blocks.length}`,
    text,
  });
}

function finalizeTurn(turn: MutableTurn): TurnCardView | null {
  const hasContent = turn.userText.trim() || turn.blocks.length > 0;
  if (!hasContent) {
    return null;
  }

  return {
    id: turn.id,
    userText: turn.userText.trim(),
    startedAt: turn.startedAt,
    updatedAt: turn.updatedAt,
    status: turn.status,
    statusTitle: turn.statusTitle,
    blocks: turn.blocks,
  };
}

export function buildTurnCards(events: TimelineEvent[]): TurnCardView[] {
  const turns: TurnCardView[] = [];
  let current: MutableTurn | null = null;
  let pendingStatus: { status: ThreadStatus; title: string; ts: string } | null = null;
  let turnIndex = 0;

  const flush = () => {
    if (!current) {
      return;
    }
    const finalized = finalizeTurn(current);
    if (finalized) {
      turns.push(finalized);
    }
    current = null;
  };

  for (const event of events) {
    if (event.kind === "metric") {
      continue;
    }

    if (event.kind === "status") {
      if (!current) {
        pendingStatus = {
          status: event.status,
          title: event.title,
          ts: event.ts,
        };
      } else {
        current.status = event.status;
        current.statusTitle = event.title;
        current.updatedAt = event.ts;
      }
      continue;
    }

    if (event.kind === "message" && event.role === "user") {
      flush();
      current = createTurn(
        `${event.ts}:${turnIndex}`,
        pendingStatus?.status ?? "running",
        pendingStatus?.title ?? "对话中",
      );
      turnIndex += 1;
      current.userText = event.text;
      current.updatedAt = event.ts;
      pendingStatus = null;
      continue;
    }

    if (!current) {
      current = createTurn(
        `${pendingStatus?.ts ?? event.ts}:${turnIndex}`,
        pendingStatus?.status ?? "running",
        pendingStatus?.title ?? "对话中",
      );
      turnIndex += 1;
      pendingStatus = null;
    }

    current.updatedAt = event.ts;

    if (event.kind === "message" && event.role === "assistant") {
      if (!event.isPlan) {
        appendMarkdownBlock(current, event.text);
      }
      continue;
    }

    if (event.kind === "tool_call") {
      if (event.tool.name === "update_plan" || event.tool.name === "write_stdin") {
        continue;
      }

      if (event.tool.name === "apply_patch") {
        ensurePatchRun(current, event.callId, {
          ts: event.ts,
          invocationText: event.tool.argumentsText,
        });
        continue;
      }

      const tool = ensureToolRun(current, event.callId, {
        ts: event.ts,
        name: event.tool.name,
        preview: toolPreview(event.tool.name, event.tool.argumentsText),
        invocationText: event.tool.argumentsText,
        commandText:
          event.tool.name === "exec_command"
            ? extractExecCommandText(event.tool.argumentsText)
            : "",
        parsedCommands: event.tool.parsedCommands,
        toolType: event.tool.toolType,
        status: event.tool.status,
      });
      placeToolRun(current, tool);
      continue;
    }

    if (event.kind === "tool_result") {
      if (event.name === "update_plan" || event.name === "write_stdin") {
        continue;
      }

      const tool = ensureToolRun(current, event.callId, {
        ts: event.ts,
        name: event.name,
        preview: event.name,
        commandText: commandTextFromResult(event.result),
        parsedCommands: event.result.parsedCommands,
        result: event.result,
      });
      tool.result = event.result;
      hydrateToolCommand(
        tool,
        commandTextFromResult(event.result),
        event.result.parsedCommands,
      );
      placeToolRun(current, tool);
      continue;
    }

    if (event.kind === "patch") {
      const patch = ensurePatchRun(current, event.callId, {
        ts: event.ts,
        summary: event.summary,
        success: event.success,
        changes: event.changes,
      });
      patch.summary = event.summary;
      patch.success = event.success;
      patch.changes = event.changes;
      continue;
    }
  }

  flush();
  return turns;
}
