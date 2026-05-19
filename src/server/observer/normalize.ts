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

export { summarizeThreadText } from "./normalizeText.js";

interface RuntimeContext {
  row: ThreadRow;
  callNames: Map<string, string>;
  callArguments?: Map<string, string>;
  status: ThreadStatus;
}

function createEventId(
  rawType: string,
  ts: string,
  lineNumber: number,
  suffix?: string,
): string {
  return [ts, rawType, lineNumber, suffix].filter(Boolean).join(":");
}

function countReplacementHistoryItems(payload: Record<string, unknown>): number | undefined {
  return Array.isArray(payload.replacement_history)
    ? payload.replacement_history.length
    : undefined;
}

function describeCompactionDetail(replacementItemCount: number | undefined): string {
  if (typeof replacementItemCount !== "number") {
    return "Codex 正在整理长会话上下文";
  }

  return `Codex 正在整理长会话上下文，压缩后保留 ${replacementItemCount} 条历史项`;
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
          title: "对话开始",
          detail: "Codex 已进入执行中状态",
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
          title: "对话结束",
          detail: "当前回合输出已结束",
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
          title: "对话中断",
          detail: "当前回合已被用户中断",
        },
      ];
    }

    if (type === "context_compacted") {
      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "compaction",
          state: "completed",
          title: "上下文压缩完成",
          detail: "Codex 已完成长会话上下文压缩",
        },
      ];
    }

    if (type === "agent_message") {
      return [];
    }

    if (type === "user_message") {
      const message =
        typeof payload.message === "string" ? payload.message : "";
      if (!message) {
        return [];
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "message",
          role: "user",
          text: message,
          isPlan: false,
        },
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
            ? `已更新 ${changes.length} 个文件`
            : "补丁应用失败",
          changes,
        },
      ];
    }

    return [];
  }

  if (outerType === "compacted") {
    const replacementItemCount = countReplacementHistoryItems(payload);

    return [
      {
        id: createEventId(outerType, ts, lineNumber),
        ts,
        kind: "compaction",
        state: "running",
        title: "正在压缩上下文",
        detail: describeCompactionDetail(replacementItemCount),
        replacementItemCount,
      },
    ];
  }

  if (outerType === "response_item") {
    const type = typeof payload.type === "string" ? payload.type : "unknown";

    if (type === "compaction" || type === "context_compaction") {
      const hasEncryptedContent = typeof payload.encrypted_content === "string";
      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "compaction",
          state: hasEncryptedContent ? "completed" : "running",
          title: hasEncryptedContent ? "上下文压缩完成" : "正在压缩上下文",
          detail: hasEncryptedContent
            ? "Codex 已生成压缩后的加密上下文"
            : "Codex 正在生成压缩后的上下文",
        },
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
