import { DiffFile } from "@git-diff-view/react";

type PatchChangeType = "add" | "delete" | "update" | string;

export interface PreparedDiffView {
  diffFile: DiffFile | null;
  fallbackText: string;
  note: string | null;
}

/** Codex apply_patch often emits bare `@@`; standard unified form has ranges. */
const HUNK_HEADER_RE = /^@@/;
const VALID_HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;
const DIFF_BODY_RE = /^(?:@@|[ +\-\\])/;

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
}

function stripTrailingEmpty(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next.at(-1) === "") {
    next.pop();
  }
  return next;
}

function defaultHeaders(fileName: string, changeType: PatchChangeType): [string, string] {
  if (changeType === "add") {
    return ["--- /dev/null", `+++ b/${fileName}`];
  }

  if (changeType === "delete") {
    return [`--- a/${fileName}`, "+++ /dev/null"];
  }

  return [`--- a/${fileName}`, `+++ b/${fileName}`];
}

function headerFileName(header: string, fallback: string): string {
  const value = header.slice(4).trim();
  if (!value || value === "/dev/null") {
    return fallback;
  }

  return value.replace(/^[ab]\//, "");
}

function isHunkHeaderLine(line: string): boolean {
  return line.startsWith("@@");
}

function isValidHunkHeader(line: string): boolean {
  return VALID_HUNK_HEADER_RE.test(line);
}

function countHunkSides(bodyLines: string[]): { oldCount: number; newCount: number } {
  let oldCount = 0;
  let newCount = 0;

  for (const line of bodyLines) {
    if (line.startsWith("\\")) {
      // "\ No newline at end of file" — not a content line.
      continue;
    }
    if (line.startsWith("-")) {
      oldCount += 1;
      continue;
    }
    if (line.startsWith("+")) {
      newCount += 1;
      continue;
    }
    // Context line (leading space, or empty treated as context).
    oldCount += 1;
    newCount += 1;
  }

  return { oldCount, newCount };
}

/**
 * Rewrite bare / incomplete `@@` headers into standard unified ranges so
 * @git-diff-view can parse multi-hunk Codex apply_patch output.
 */
export function normalizeHunkHeaders(bodyLines: string[]): string[] {
  const result: string[] = [];
  let index = 0;
  let oldCursor = 1;
  let newCursor = 1;

  while (index < bodyLines.length) {
    const line = bodyLines[index] ?? "";
    if (!isHunkHeaderLine(line)) {
      result.push(line);
      index += 1;
      continue;
    }

    const headerLine = line;
    index += 1;
    const hunkBody: string[] = [];
    while (index < bodyLines.length && !isHunkHeaderLine(bodyLines[index] ?? "")) {
      hunkBody.push(bodyLines[index] ?? "");
      index += 1;
    }

    if (isValidHunkHeader(headerLine)) {
      result.push(headerLine, ...hunkBody);
      const { oldCount, newCount } = countHunkSides(hunkBody);
      // Advance cursors from declared ranges when present so later synthesized
      // hunks stay ordered; fall back to body counts.
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(headerLine);
      if (match) {
        const oldStart = Number(match[1]);
        const oldLen = match[2] == null ? 1 : Number(match[2]);
        const newStart = Number(match[3]);
        const newLen = match[4] == null ? 1 : Number(match[4]);
        oldCursor = oldStart + oldLen;
        newCursor = newStart + newLen;
      } else {
        oldCursor += oldCount;
        newCursor += newCount;
      }
      continue;
    }

    const { oldCount, newCount } = countHunkSides(hunkBody);
    const oldStart = oldCount === 0 ? Math.max(0, oldCursor - 1) : oldCursor;
    const newStart = newCount === 0 ? Math.max(0, newCursor - 1) : newCursor;
    result.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...hunkBody,
    );
    oldCursor = oldCount === 0 ? oldCursor : oldStart + oldCount;
    newCursor = newCount === 0 ? newCursor : newStart + newCount;
  }

  return result;
}

function extractDiffText(unifiedDiff: string, fileName: string, changeType: PatchChangeType) {
  const lines = stripTrailingEmpty(normalizeLines(unifiedDiff));
  let oldHeader = "";
  let newHeader = "";
  const bodyLines: string[] = [];
  const noteLines: string[] = [];
  let sawHunk = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (!sawHunk) {
      if (line.startsWith("--- ")) {
        oldHeader = line;
        continue;
      }

      if (line.startsWith("+++ ")) {
        newHeader = line;
        continue;
      }

      if (HUNK_HEADER_RE.test(line)) {
        sawHunk = true;
        bodyLines.push(line);
      }
      continue;
    }

    if (DIFF_BODY_RE.test(line)) {
      bodyLines.push(line);
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    noteLines.push(...lines.slice(index));
    break;
  }

  if (!sawHunk || bodyLines.length === 0) {
    return { diffText: "", note: noteLines.join("\n").trim() || null };
  }

  const [fallbackOldHeader, fallbackNewHeader] = defaultHeaders(fileName, changeType);
  const normalizedBody = normalizeHunkHeaders(bodyLines);
  const diffText = [
    oldHeader || fallbackOldHeader,
    newHeader || fallbackNewHeader,
    ...normalizedBody,
  ].join("\n");

  return {
    diffText,
    note: noteLines.join("\n").trim() || null,
  };
}

export function prepareDiffView(
  fileName: string,
  unifiedDiff: string,
  changeType: PatchChangeType = "update",
): PreparedDiffView {
  const { diffText, note } = extractDiffText(unifiedDiff, fileName, changeType);

  if (!diffText) {
    return {
      diffFile: null,
      fallbackText: unifiedDiff,
      note,
    };
  }

  try {
    const lines = diffText.split("\n");
    const parserDiffText = diffText.endsWith("\n") ? diffText : `${diffText}\n`;
    const diffFile = new DiffFile(
      headerFileName(lines[0] ?? "", fileName),
      "",
      headerFileName(lines[1] ?? "", fileName),
      "",
      [parserDiffText],
    );
    diffFile.initTheme("light");
    diffFile.initRaw();
    diffFile.buildSplitDiffLines();
    diffFile.buildUnifiedDiffLines();

    if (diffFile.unifiedLineLength === 0 && diffFile.splitLineLength === 0) {
      throw new Error("empty diff bundle");
    }

    return {
      diffFile,
      fallbackText: diffText,
      note,
    };
  } catch {
    return {
      diffFile: null,
      fallbackText: diffText,
      note,
    };
  }
}
