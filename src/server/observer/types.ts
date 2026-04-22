import type {
  ThreadStatus,
  ThreadSummary,
  TimelineEvent,
} from "../../shared/types.js";

export interface ThreadRow {
  id: string;
  rollout_path: string;
  created_at_ms: number;
  updated_at_ms: number;
  source: string;
  cwd: string;
  title: string;
  cli_version: string;
  first_user_message: string;
}

export interface ThreadRuntimeState {
  summary: ThreadSummary;
  events: TimelineEvent[];
  status: ThreadStatus;
  offset: number;
  loaded: boolean;
}

export interface SQLiteQueryOptions {
  readonly dbPath: string;
}
