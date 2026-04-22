export type ThreadStatus = "idle" | "running" | "completed" | "error";

export interface ThreadSummary {
  id: string;
  cwd: string;
  displayName: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cliVersion: string;
  source: string;
  rolloutPath: string;
  firstUserMessage: string;
  status: ThreadStatus;
  eventCount: number;
}

export interface ProjectSummary {
  cwd: string;
  displayName: string;
  latestUpdatedAt: number;
  activeThreadCount: number;
  totalThreadCount: number;
  recentThreads: ThreadSummary[];
}

export interface ThreadSnapshot {
  thread: ThreadSummary;
  events: TimelineEvent[];
  nextCursor: number;
}

export interface ThreadPage {
  items: ThreadSummary[];
  nextCursor: string | null;
}

export type ParsedCommand =
  | {
      type: "read";
      cmd: string;
      name: string;
      path: string;
    }
  | {
      type: "search";
      cmd: string;
      query: string | null;
      path: string | null;
    }
  | {
      type: "list_files";
      cmd: string;
      path: string | null;
    }
  | {
      type: "unknown";
      cmd: string;
    };

export interface ToolInvocation {
  name: string;
  argumentsText: string;
  status?: string;
  toolType: "function_call" | "custom_tool_call";
  parsedCommands?: ParsedCommand[];
}

export interface ToolResultPayload {
  toolType:
    | "function_call_output"
    | "custom_tool_call_output"
    | "exec_command_end";
  title: string;
  success: boolean | null;
  exitCode: number | null;
  outputText: string;
  stderrText: string;
  parsedCommands?: ParsedCommand[];
  raw: unknown;
}

export interface PatchChange {
  path: string;
  displayPath: string;
  changeType: string;
  unifiedDiff: string;
}

export type TimelineEvent =
  | {
      id: string;
      ts: string;
      kind: "status";
      status: ThreadStatus;
      title: string;
      detail?: string;
    }
  | {
      id: string;
      ts: string;
      kind: "message";
      role: "assistant" | "user" | "system";
      phase?: string;
      text: string;
      isPlan: boolean;
    }
  | {
      id: string;
      ts: string;
      kind: "tool_call";
      callId: string;
      tool: ToolInvocation;
    }
  | {
      id: string;
      ts: string;
      kind: "tool_result";
      callId: string;
      name: string;
      result: ToolResultPayload;
    }
  | {
      id: string;
      ts: string;
      kind: "patch";
      callId: string;
      success: boolean;
      summary: string;
      changes: PatchChange[];
    }
  | {
      id: string;
      ts: string;
      kind: "metric";
      title: string;
      detail: string;
    }
  | {
      id: string;
      ts: string;
      kind: "raw";
      title: string;
      payload: unknown;
    };

export interface StreamEnvelope {
  type: "ready" | "timeline";
  cursor: number;
  event?: TimelineEvent;
}
