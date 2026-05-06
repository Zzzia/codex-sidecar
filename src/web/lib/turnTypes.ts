import type {
  ContextCompactionState,
  PatchChange,
  ThreadStatus,
  ToolInvocation,
  ToolResultPayload,
} from "@shared/types";
import type { ParsedExecCommand } from "./commandSemantics";

export interface ToolRunView {
  callId: string;
  id: string;
  ts: string;
  name: string;
  preview: string;
  invocationText: string;
  commandText: string;
  parsedCommands: ParsedExecCommand[];
  toolType: ToolInvocation["toolType"] | "unknown";
  status?: string;
  result: ToolResultPayload | null;
  patchSummary: string | null;
  patchSuccess: boolean | null;
  patchChanges: PatchChange[];
  placement: "tool" | "exploration" | null;
}

export interface PatchRunView {
  callId: string;
  id: string;
  ts: string;
  invocationText: string;
  summary: string;
  success: boolean;
  changes: PatchChange[];
}

export interface CompactionRunView {
  id: string;
  ts: string;
  completedAt?: string;
  state: ContextCompactionState;
  title: string;
  detail: string;
  replacementItemCount?: number;
}

export type ExplorationStepView =
  | {
      kind: "read";
      id: string;
      ts: string;
      files: string[];
      tools: ToolRunView[];
    }
  | {
      kind: "search";
      id: string;
      ts: string;
      query: string | null;
      path: string | null;
      tools: ToolRunView[];
    }
  | {
      kind: "list";
      id: string;
      ts: string;
      path: string | null;
      tools: ToolRunView[];
    };

export type TurnBlock =
  | {
      type: "assistant_markdown";
      id: string;
      text: string;
    }
  | {
      type: "proposed_plan";
      id: string;
      text: string;
    }
  | {
      type: "exploration_runs";
      id: string;
      items: ExplorationStepView[];
    }
  | {
      type: "tool_runs";
      id: string;
      items: ToolRunView[];
    }
  | {
      type: "patch_runs";
      id: string;
      items: PatchRunView[];
    }
  | {
      type: "compaction_runs";
      id: string;
      items: CompactionRunView[];
    };

export interface TurnCardView {
  id: string;
  userText: string;
  startedAt: string;
  updatedAt: string;
  status: ThreadStatus;
  statusTitle: string;
  blocks: TurnBlock[];
}
