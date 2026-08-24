import path from "node:path";
import type {
  ThreadStatus,
  TimelineEvent,
} from "../../shared/types.js";
import type { ThreadRow } from "./types.js";
import { normalizePatchChanges } from "./normalizePatch.js";
import {
  normalizeExecResult,
  normalizeParsedCommands,
  normalizeToolOutput,
} from "./normalizeToolOutput.js";
import {
  extractTextContent,
  getMessageRole,
  splitProposedPlanBlocks,
  stripMemoryCitationBlocks,
  summarizeThreadText,
} from "./normalizeText.js";
import {
  compactionEvent,
  compactionReplacesAssistant,
  countReplacementHistoryItems,
  describeCompactionDetail,
  eventItemType,
} from "./normalizeCompaction.js";

export { summarizeThreadText } from "./normalizeText.js";

interface RuntimeContext {
  row: ThreadRow;
  callNames: Map<string, string>;
  callArguments?: Map<string, string>;
  status: ThreadStatus;
  lastAssistantText?: string;
}

function createEventId(
  rawType: string,
  ts: string,
  lineNumber: number,
  suffix?: string,
): string {
  return [ts, rawType, lineNumber, suffix].filter(Boolean).join(":");
}

function userMessageTextFromEvent(
  type: string,
  payload: Record<string, unknown>,
): string | null {
  if (type === "user_message") {
    return typeof payload.message === "string" ? payload.message.trim() : "";
  }

  if (type === "item_completed" && eventItemType(payload) === "UserMessage") {
    const item = payload.item;
    if (!item || typeof item !== "object") {
      return "";
    }
    return extractTextContent((item as Record<string, unknown>).content).trim();
  }

  return null;
}

function userMessageEvent(
  id: string,
  ts: string,
  text: string,
): TimelineEvent {
  return {
    id,
    ts,
    kind: "message",
    role: "user",
    text,
    isPlan: false,
  };
}

export function createThreadSummary(row: ThreadRow) {
  const title = summarizeThreadText(row.title || row.first_user_message || row.id);
  const firstUserMessage = summarizeThreadText(row.first_user_message || "");

  return {
    id: row.id,
    cwd: row.cwd,
    displayName: path.basename(row.cwd) || row.cwd,
    title,
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms,
    cliVersion: row.cli_version || "",
    source: row.source,
    rolloutPath: row.rollout_path,
    firstUserMessage,
    status: "idle" as ThreadStatus,
    eventCount: 0,
    contextWindowUsage: null,
  };
}

export function normalizeRecord(
  raw: unknown,
  context: RuntimeContext,
  lineNumber: number,
): TimelineEvent[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const record = raw as Record<string, unknown>;
  const ts = typeof record.timestamp === "string" ? record.timestamp : "";
  const payload =
    record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : {};
  const outerType = typeof record.type === "string" ? record.type : "unknown";

  if (outerType === "event_msg") {
    const type = typeof payload.type === "string" ? payload.type : "unknown";

    if (type === "task_started") {
      context.status = "running";
      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "status",
          status: "running",
          title: "Turn started",
          detail: "Codex is running",
        },
      ];
    }

    if (type === "task_complete") {
      context.status = "completed";
      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "status",
          status: "completed",
          title: "Turn completed",
          detail: "Current turn output has finished",
        },
      ];
    }

    if (type === "turn_aborted") {
      context.status = "completed";
      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "status",
          status: "completed",
          title: "Turn interrupted",
          detail: "Current turn was interrupted by the user",
        },
      ];
    }

    if (type === "context_compacted") {
      return [
        compactionEvent({
          id: createEventId(type, ts, lineNumber),
          ts,
          state: "completed",
          title: "Context compaction completed",
          detail: describeCompactionDetail("completed", undefined),
        }),
      ];
    }

    if (
      (type === "item_started" || type === "item_completed") &&
      eventItemType(payload) === "ContextCompaction"
    ) {
      const state = type === "item_completed" ? "completed" : "running";
      return [
        compactionEvent({
          id: createEventId(type, ts, lineNumber),
          ts,
          state,
          title:
            state === "completed"
              ? "Context compaction completed"
              : "Compacting context",
          detail: describeCompactionDetail(state, undefined),
        }),
      ];
    }

    if (type === "agent_message") {
      return [];
    }

    const userMessageText = userMessageTextFromEvent(type, payload);
    if (userMessageText !== null) {
      if (!userMessageText) {
        return [];
      }

      return [
        userMessageEvent(createEventId(type, ts, lineNumber), ts, userMessageText),
      ];
    }

    if (type === "token_count") {
      return [];
    }

    if (type === "exec_command_end") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const name = context.callNames.get(callId) ?? "exec_command";

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "tool_result",
          callId,
          name,
          result: normalizeExecResult(payload, name),
        },
      ];
    }

    if (type === "patch_apply_end") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const changes = normalizePatchChanges(payload.changes, context.row.cwd);
      const success = Boolean(payload.success);

      if (!success) {
        context.status = "error";
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "patch",
          callId,
          success,
          summary: success
            ? `Updated ${changes.length} ${changes.length === 1 ? "file" : "files"}`
            : "Patch apply failed",
          changes,
        },
      ];
    }

    return [];
  }

  if (outerType === "compacted") {
    const replacementItemCount = countReplacementHistoryItems(payload);
    const compactedMessage =
      typeof payload.message === "string" ? payload.message : "";
    const replacedAssistantText = compactionReplacesAssistant(
      context.lastAssistantText,
      compactedMessage,
    )
      ? context.lastAssistantText
      : undefined;

    return [
      compactionEvent({
        id: createEventId(outerType, ts, lineNumber),
        ts,
        state: "completed",
        title: "Context compaction completed",
        detail: describeCompactionDetail("completed", replacementItemCount),
        replacementItemCount,
        replacedAssistantText,
      }),
    ];
  }

  if (outerType === "response_item") {
    const type = typeof payload.type === "string" ? payload.type : "unknown";

    if (type === "compaction" || type === "context_compaction") {
      const hasEncryptedContent = typeof payload.encrypted_content === "string";
      const state = hasEncryptedContent ? "completed" : "running";
      return [
        compactionEvent({
          id: createEventId(type, ts, lineNumber),
          ts,
          state,
          title:
            state === "completed"
              ? "Context compaction completed"
              : "Compacting context",
          detail: hasEncryptedContent
            ? "Codex generated compacted encrypted context"
            : "Codex is generating compacted context",
        }),
      ];
    }

    if (type === "message") {
      const role = getMessageRole(payload.role);
      if (role !== "assistant") {
        return [];
      }

      const text = stripMemoryCitationBlocks(extractTextContent(payload.content));
      const segments = splitProposedPlanBlocks(text);
      if (segments.length === 0) {
        return [];
      }

      context.lastAssistantText = segments
        .filter((segment) => segment.kind !== "plan")
        .map((segment) => segment.text)
        .join("\n\n")
        .trim() || text;

      return segments.map((segment, index) => ({
        id: createEventId(
          type,
          ts,
          lineNumber,
          segments.length > 1 ? `${segment.kind}:${index}` : undefined,
        ),
        ts,
        kind: "message",
        role,
        phase: typeof payload.phase === "string" ? payload.phase : undefined,
        text: segment.text,
        isPlan: segment.kind === "plan",
      }));
    }

    if (type === "function_call" || type === "custom_tool_call") {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const argumentsText =
        typeof payload.arguments === "string"
          ? payload.arguments
          : typeof payload.input === "string"
            ? payload.input
            : "";
      if (callId) {
        context.callNames.set(callId, name);
        context.callArguments?.set(callId, argumentsText);
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "tool_call",
          callId,
          tool: {
            name,
            argumentsText,
            status: typeof payload.status === "string" ? payload.status : undefined,
            toolType: type,
            parsedCommands: normalizeParsedCommands(payload.parsed_cmd),
          },
        },
      ];
    }

    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const name = context.callNames.get(callId) ?? "tool";
      const argumentsText = context.callArguments?.get(callId) ?? "";
      if (name === "apply_patch") {
        return [];
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "tool_result",
          callId,
          name,
          result: normalizeToolOutput(payload, name, argumentsText),
        },
      ];
    }

    if (type === "reasoning") {
      const summary =
        Array.isArray(payload.summary) && payload.summary.length > 0
          ? JSON.stringify(payload.summary)
          : "";
      if (!summary) {
        return [];
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "raw",
          title: "Reasoning Summary",
          payload: payload.summary,
        },
      ];
    }
  }

  return [];
}
