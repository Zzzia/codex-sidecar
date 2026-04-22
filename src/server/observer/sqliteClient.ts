import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ThreadRow } from "./types.js";

const execFileAsync = promisify(execFile);

function escapeSqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runJsonQuery<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
  if (!stdout.trim()) {
    return [];
  }

  return JSON.parse(stdout) as T[];
}

export async function listRecentCliThreads(
  dbPath: string,
  limit: number,
): Promise<ThreadRow[]> {
  return runJsonQuery<ThreadRow>(
    dbPath,
    `
      select
        id,
        rollout_path,
        coalesce(created_at_ms, created_at * 1000) as created_at_ms,
        coalesce(updated_at_ms, updated_at * 1000) as updated_at_ms,
        source,
        cwd,
        title,
        cli_version,
        first_user_message
      from threads
      where source = 'cli' and archived = 0
      order by updated_at_ms desc, id desc
      limit ${Math.max(1, Math.min(limit, 200))}
    `,
  );
}

export async function listCliThreadsByCwd(
  dbPath: string,
  cwd: string,
  limit: number,
  cursor?: { updatedAt: number; id: string },
): Promise<ThreadRow[]> {
  const escapedCwd = escapeSqlText(cwd);
  const clauses = [`source = 'cli'`, `archived = 0`, `cwd = ${escapedCwd}`];

  if (cursor) {
    const escapedId = escapeSqlText(cursor.id);
    clauses.push(
      `(updated_at_ms < ${cursor.updatedAt} or (updated_at_ms = ${cursor.updatedAt} and id < ${escapedId}))`,
    );
  }

  return runJsonQuery<ThreadRow>(
    dbPath,
    `
      select
        id,
        rollout_path,
        coalesce(created_at_ms, created_at * 1000) as created_at_ms,
        coalesce(updated_at_ms, updated_at * 1000) as updated_at_ms,
        source,
        cwd,
        title,
        cli_version,
        first_user_message
      from threads
      where ${clauses.join(" and ")}
      order by updated_at_ms desc, id desc
      limit ${Math.max(1, Math.min(limit, 100))}
    `,
  );
}

export async function findThreadById(
  dbPath: string,
  id: string,
): Promise<ThreadRow | null> {
  const rows = await runJsonQuery<ThreadRow>(
    dbPath,
    `
      select
        id,
        rollout_path,
        coalesce(created_at_ms, created_at * 1000) as created_at_ms,
        coalesce(updated_at_ms, updated_at * 1000) as updated_at_ms,
        source,
        cwd,
        title,
        cli_version,
        first_user_message
      from threads
      where id = ${escapeSqlText(id)}
      limit 1
    `,
  );

  return rows[0] ?? null;
}
