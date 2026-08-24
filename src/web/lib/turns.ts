import type {
  ThreadStatus,
  TimelineEvent,
} from "@shared/types";
import { isApplyPatchOnlyCodeModeScript } from "./codeModeApplyPatch";
import { isUpdatePlanOnlyCodeModeScript } from "./codeModeUpdatePlan";
import {
  extractNestedWriteStdinActions,
  extractShellCommandTexts,
  shellToolDisplayTextFromInvocation,
} from "./commandSemantics";
import { commandTextFromResult, toolPreview } from "./toolPresentation";
import {
  registerCodeModeApplyPatches,
  registerDirectApplyPatch,
  settlePatchRun,
} from "./turnsPatch";
import { appendCompactionRun } from "./turnsCompaction";
import {
  ensureToolRun,
  hydrateToolCommand,
  mergeWriteStdinResultIntoExec,
  placeToolRun,
} from "./turnsTools";
import type {
  PatchRunView,
  ToolRunView,
  TurnBlock,
  TurnCardView,
} from "./turnTypes";
export type {
  CompactionRunView,
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
  /** Code-mode provisional patches waiting for patch_apply_end (order-stable). */
  pendingPatchCallIds: string[];
}

const DEFAULT_TURN_TITLE = "Turn started";

function createTurn(
  idSeed: string,
  startedAt: string,
  status: ThreadStatus,
  title: string,
): MutableTurn {
  return {
    id: `turn:${idSeed}`,
    userText: "",
    startedAt,
    updatedAt: startedAt,
    status,
    statusTitle: title,
    blocks: [],
    toolMap: new Map(),
    patchMap: new Map(),
    pendingPatchCallIds: [],
  };
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

function appendProposedPlanBlock(turn: MutableTurn, text: string): void {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "proposed_plan") {
    last.text = `${last.text}\n\n${text}`.trim();
    return;
  }

  turn.blocks.push({
    type: "proposed_plan",
    id: `proposed_plan:${turn.blocks.length}`,
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
      } else if (
        event.status === "running" &&
        current.status === "completed" &&
        (current.userText.trim() || current.blocks.length > 0)
      ) {
        flush();
        pendingStatus = {
          status: event.status,
          title: event.title,
          ts: event.ts,
        };
      } else {
        current.status = event.status;
        if (!current.statusTitle || current.statusTitle === "In progress" || current.statusTitle === "Idle") {
          current.statusTitle = event.title;
        }
        current.updatedAt = event.ts;
      }
      continue;
    }

    if (event.kind === "message" && event.role === "user") {
      flush();
      const startedAt = event.ts;
      current = createTurn(
        `${startedAt}:${turnIndex}`,
        startedAt,
        pendingStatus?.status ?? "running",
        pendingStatus?.title ?? DEFAULT_TURN_TITLE,
      );
      turnIndex += 1;
      current.userText = event.text;
      current.updatedAt = event.ts;
      pendingStatus = null;
      continue;
    }

    if (!current) {
      const startedAt = pendingStatus?.ts ?? event.ts;
      current = createTurn(
        `${startedAt}:${turnIndex}`,
        startedAt,
        pendingStatus?.status ?? "running",
        pendingStatus?.title ?? DEFAULT_TURN_TITLE,
      );
      turnIndex += 1;
      pendingStatus = null;
    }

    current.updatedAt = event.ts;

    if (event.kind === "message" && event.role === "assistant") {
      if (event.isPlan) {
        appendProposedPlanBlock(current, event.text);
      } else {
        appendMarkdownBlock(current, event.text);
      }
      continue;
    }

    if (event.kind === "compaction") {
      appendCompactionRun(current, event);
      continue;
    }

    if (event.kind === "tool_call") {
      if (event.tool.name === "update_plan" || event.tool.name === "write_stdin") {
        continue;
      }

      if (event.tool.name === "exec") {
        const script = event.tool.argumentsText;
        const hasNestedShellOrWriteWork =
          extractShellCommandTexts("exec", script).length > 0 ||
          extractNestedWriteStdinActions(script).length > 0;

        registerCodeModeApplyPatches(current, event.callId, event.ts, script);

        if (isApplyPatchOnlyCodeModeScript(script, hasNestedShellOrWriteWork)) {
          // Nested apply_patch is rendered as patch cards; hide the outer JS script.
          continue;
        }

        if (isUpdatePlanOnlyCodeModeScript(script, hasNestedShellOrWriteWork)) {
          // Progress-only code-mode scripts stay out of the timeline body.
          // extractThreadProgress still reads tools.update_plan from the raw event.
          continue;
        }

        // Mixed scripts: shell/write work stays as a tool card; patches already registered.
        // Never fall back to dumping the full JS script as the command preview.
        const displayText = shellToolDisplayTextFromInvocation("exec", script);
        const tool = ensureToolRun(current, event.callId, {
          ts: event.ts,
          name: event.tool.name,
          preview: displayText || "code-mode script",
          invocationText: script,
          commandText: displayText,
          parsedCommands: event.tool.parsedCommands,
          toolType: event.tool.toolType,
          status: event.tool.status,
        });
        placeToolRun(current, tool);
        continue;
      }

      if (event.tool.name === "apply_patch") {
        registerDirectApplyPatch(
          current,
          event.callId,
          event.ts,
          event.tool.argumentsText,
        );
        continue;
      }

      const displayText = shellToolDisplayTextFromInvocation(
        event.tool.name,
        event.tool.argumentsText,
      );
      const tool = ensureToolRun(current, event.callId, {
        ts: event.ts,
        name: event.tool.name,
        preview:
          displayText || toolPreview(event.tool.name, event.tool.argumentsText),
        invocationText: event.tool.argumentsText,
        commandText: displayText,
        parsedCommands: event.tool.parsedCommands,
        toolType: event.tool.toolType,
        status: event.tool.status,
      });
      placeToolRun(current, tool);
      continue;
    }

    if (event.kind === "tool_result") {
      if (event.name === "update_plan") {
        continue;
      }

      if (event.name === "exec") {
        const existing = current.toolMap.get(event.callId);
        if (!existing) {
          // Matching tool_call was progress-only or apply_patch-only code-mode.
          continue;
        }
      }

      if (event.name === "write_stdin") {
        mergeWriteStdinResultIntoExec(current, event.result);
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
      settlePatchRun(current, event.callId, {
        ts: event.ts,
        summary: event.summary,
        success: event.success,
        changes: event.changes,
      });
      continue;
    }
  }

  flush();
  return turns;
}

export function resolveTurnCardStatuses(
  cards: TurnCardView[],
  threadStatus: ThreadStatus,
): TurnCardView[] {
  if (cards.length === 0) {
    return cards;
  }

  if (threadStatus === "running" || threadStatus === "idle") {
    return cards;
  }

  const last = cards[cards.length - 1];
  if (last.status !== "running" && last.status !== "idle") {
    return cards;
  }

  const nextLast: TurnCardView = {
    ...last,
    status: threadStatus,
  };

  return [...cards.slice(0, -1), nextLast];
}
