import path from "node:path";
import type { PatchChange } from "../../shared/types.js";

function displayPath(filePath: string, cwd: string): string {
  if (filePath.startsWith(cwd)) {
    return path.relative(cwd, filePath) || path.basename(filePath);
  }
  return filePath;
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

export function normalizePatchChanges(changes: unknown, cwd: string): PatchChange[] {
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
