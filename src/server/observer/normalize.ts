import path from "node:path";
import type {
  PatchChange,
  ParsedCommand,
  ThreadStatus,
  TimelineEvent,
  ToolResultPayload,
} from "../../shared/types.js";
import type { ThreadRow } from "./types.js";

interface RuntimeContext {
  row: ThreadRow;
  callNames: Map<string, string>;
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

function displayPath(filePath: string, cwd: string): string {
  if (filePath.startsWith(cwd)) {
    return path.relative(cwd, filePath) || path.basename(filePath);
  }
  return filePath;
}

const THREAD_SUMMARY_TEXT_LIMIT = 100;

export function summarizeThreadText(
  value: string,
  limit = THREAD_SUMMARY_TEXT_LIMIT,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const chars = Array.from(normalized);
  if (chars.length <= limit) {
    return normalized;
  }

  return `${chars.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const part = entry as Record<string, unknown>;
      const text = part.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("");
}

function containsProposedPlan(text: string): boolean {
  return /<proposed_plan>\s*[\s\S]*?<\/proposed_plan>/.test(text);
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolOutput(
  payload: Record<string, unknown>,
  fallbackTitle: string,
): ToolResultPayload {
  const parsed = parseJsonString(payload.output);
  const data =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const outputText = typeof data.output === "string" ? data.output : "";
  const stderrText = typeof data.stderr === "string" ? data.stderr : "";
  const exitCode =
    typeof metadata.exit_code === "number" ? metadata.exit_code : null;

  return {
    toolType:
      payload.type === "custom_tool_call_output"
        ? "custom_tool_call_output"
        : "function_call_output",
    title: fallbackTitle,
    success: exitCode === null ? null : exitCode === 0,
    exitCode,
    outputText,
    stderrText,
    parsedCommands: [],
    raw: parsed,
  };
}

function normalizeParsedCommands(value: unknown): ParsedCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const type = record.type;
      const cmd = typeof record.cmd === "string" ? record.cmd : "";

      if (type === "read") {
        const name = typeof record.name === "string" ? record.name : "";
        const filePath = typeof record.path === "string" ? record.path : "";
        if (!name || !filePath) {
          return null;
        }
        return {
          type,
          cmd,
          name,
          path: filePath,
        } satisfies ParsedCommand;
      }

      if (type === "search") {
        return {
          type,
          cmd,
          query: typeof record.query === "string" ? record.query : null,
          path: typeof record.path === "string" ? record.path : null,
        } satisfies ParsedCommand;
      }

      if (type === "list_files") {
        return {
          type,
          cmd,
          path: typeof record.path === "string" ? record.path : null,
        } satisfies ParsedCommand;
      }

      if (type === "unknown") {
        return {
          type,
          cmd,
        } satisfies ParsedCommand;
      }

      return null;
    })
    .filter((entry): entry is ParsedCommand => Boolean(entry));
}

function normalizeExecResult(
  payload: Record<string, unknown>,
  fallbackTitle: string,
): ToolResultPayload {
  return {
    toolType: "exec_command_end",
    title: fallbackTitle,
    success:
      typeof payload.exit_code === "number" ? payload.exit_code === 0 : null,
    exitCode: typeof payload.exit_code === "number" ? payload.exit_code : null,
    outputText:
      typeof payload.aggregated_output === "string"
        ? payload.aggregated_output
        : "",
    stderrText:
      typeof payload.stderr === "string" ? payload.stderr : "",
    parsedCommands: normalizeParsedCommands(payload.parsed_cmd),
    raw: payload,
  };
}

function getMessageRole(role: unknown): "assistant" | "user" | "system" {
  if (role === "assistant" || role === "user") {
    return role;
  }
  return "system";
}

function normalizePatchContent(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function synthesizeUnifiedDiff(
  filePath: string,
  displayName: string,
  info: Record<string, unknown>,
): string {
  if (typeof info.unified_diff === "string" && info.unified_diff.trim()) {
    const movePath = typeof info.move_path === "string" ? info.move_path : "";
    if (!movePath) {
      return info.unified_diff;
    }

    return `${info.unified_diff}\n\nMoved to: ${movePath}`;
  }

  const content = typeof info.content === "string" ? info.content : "";
  const lines = normalizePatchContent(content);
  const fileLabel = displayName || path.basename(filePath) || filePath;

  if (info.type === "add") {
    return [
      "--- /dev/null",
      `+++ b/${fileLabel}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n");
  }

  if (info.type === "delete") {
    return [
      `--- a/${fileLabel}`,
      "+++ /dev/null",
      `@@ -1,${lines.length} +0,0 @@`,
      ...lines.map((line) => `-${line}`),
    ].join("\n");
  }

  return "";
}

function normalizePatchChanges(changes: unknown, cwd: string): PatchChange[] {
  if (!changes || typeof changes !== "object") {
    return [];
  }

  return Object.entries(changes as Record<string, unknown>).map(
    ([filePath, entry]) => {
      const info =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};

      const shownPath = displayPath(filePath, cwd);

      return {
        path: filePath,
        displayPath: shownPath,
        changeType: typeof info.type === "string" ? info.type : "update",
        unifiedDiff: synthesizeUnifiedDiff(filePath, shownPath, info),
      };
    },
  );
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

  if (outerType === "response_item") {
    const type = typeof payload.type === "string" ? payload.type : "unknown";

    if (type === "message") {
      const text = extractTextContent(payload.content);
      if (!text) {
        return [];
      }

      const role = getMessageRole(payload.role);
      if (role !== "assistant") {
        return [];
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "message",
          role,
          phase: typeof payload.phase === "string" ? payload.phase : undefined,
          text,
          isPlan: containsProposedPlan(text),
        },
      ];
    }

    if (type === "function_call" || type === "custom_tool_call") {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      if (callId) {
        context.callNames.set(callId, name);
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "tool_call",
          callId,
          tool: {
            name,
            argumentsText:
              typeof payload.arguments === "string"
                ? payload.arguments
                : typeof payload.input === "string"
                  ? payload.input
                  : "",
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
      if (name === "exec_command" || name === "apply_patch") {
        return [];
      }

      return [
        {
          id: createEventId(type, ts, lineNumber),
          ts,
          kind: "tool_result",
          callId,
          name,
          result: normalizeToolOutput(payload, name),
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
