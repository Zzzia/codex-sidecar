import path from "node:path";
import type {
  ProjectSummary,
  ThreadPage,
  ThreadSnapshot,
  TimelineEvent,
} from "../../shared/types.js";
import {
  countCliThreadsByCwds,
  findThreadById,
  listCliThreadsByCwd,
  listRecentCliThreads,
} from "./sqliteClient.js";
import { ThreadRuntime } from "./ThreadRuntime.js";
import type { ThreadRow } from "./types.js";

function encodeCursor(updatedAt: number, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { updatedAt: number; id: string } | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { updatedAt: number; id: string };
    if (typeof parsed.updatedAt === "number" && typeof parsed.id === "string") {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export class CodexObserver {
  private readonly dbPath: string;
  private readonly runtimes = new Map<string, ThreadRuntime>();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async listProjects(limit = 60): Promise<ProjectSummary[]> {
    const rows = await listRecentCliThreads(this.dbPath, limit);
    const byProject = new Map<string, ThreadRow[]>();

    for (const row of rows) {
      const list = byProject.get(row.cwd) ?? [];
      list.push(row);
      byProject.set(row.cwd, list);
    }

    const projects: ProjectSummary[] = [];
    const totalCounts = await countCliThreadsByCwds(
      this.dbPath,
      [...byProject.keys()],
    );

    for (const [cwd, threadRows] of byProject.entries()) {
      const summaries = await Promise.all(
        threadRows.map(async (row) => {
          const runtime = await this.ensureRuntime(row);
          await runtime.ensureLoaded();
          return runtime.getSummary();
        }),
      );

      summaries.sort(
        (left: { updatedAt: number }, right: { updatedAt: number }) =>
          right.updatedAt - left.updatedAt,
      );

      projects.push({
        cwd,
        displayName: path.basename(cwd) || cwd,
        latestUpdatedAt: summaries[0]?.updatedAt ?? 0,
        activeThreadCount: summaries.filter(
          (item: { status: string }) => item.status === "running",
        ).length,
        totalThreadCount: totalCounts[cwd] ?? summaries.length,
        recentThreads: summaries.slice(0, 3),
      });
    }

    return projects.sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt);
  }

  async listThreadsByProject(
    cwd: string,
    cursor?: string,
    limit = 20,
  ): Promise<ThreadPage> {
    const decodedCursor = decodeCursor(cursor);
    const rows = await listCliThreadsByCwd(this.dbPath, cwd, limit + 1, decodedCursor);
    const pageRows = rows.slice(0, limit);
    const items = await Promise.all(
      pageRows.map(async (row: ThreadRow) => {
        const runtime = await this.ensureRuntime(row);
        await runtime.ensureLoaded();
        return runtime.getSummary();
      }),
    );

    const next = rows.length > limit ? rows[limit] : null;

    return {
      items,
      nextCursor: next ? encodeCursor(next.updated_at_ms, next.id) : null,
    };
  }

  async getThreadSnapshot(threadId: string): Promise<ThreadSnapshot> {
    const runtime = await this.getRuntime(threadId);
    return runtime.getSnapshot();
  }

  async getEventsSince(threadId: string, cursor: number): Promise<TimelineEvent[]> {
    const runtime = await this.getRuntime(threadId);
    return runtime.getEventsSince(cursor);
  }

  async subscribe(
    threadId: string,
    listener: (event: TimelineEvent, cursor: number) => void,
  ): Promise<() => void> {
    const runtime = await this.getRuntime(threadId);
    return runtime.subscribe(listener);
  }

  private async getRuntime(threadId: string): Promise<ThreadRuntime> {
    const current = this.runtimes.get(threadId);
    if (current) {
      return current;
    }

    const row = await findThreadById(this.dbPath, threadId);
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    return this.ensureRuntime(row);
  }

  private async ensureRuntime(row: ThreadRow): Promise<ThreadRuntime> {
    const existing = this.runtimes.get(row.id);
    if (existing) {
      existing.updateRow(row);
      return existing;
    }

    const runtime = new ThreadRuntime(row);
    this.runtimes.set(row.id, runtime);
    return runtime;
  }
}
