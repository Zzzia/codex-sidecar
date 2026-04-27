import { DiffFile } from "@git-diff-view/react";

type PatchChangeType = "add" | "delete" | "update" | string;

export interface PreparedDiffView {
  diffFile: DiffFile | null;
  fallbackText: string;
  note: string | null;
}

const HUNK_HEADER_RE = /^@@ /;
const DIFF_BODY_RE = /^(?:@@ |[ +\-\\])/;

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
  const diffText = [
    oldHeader || fallbackOldHeader,
    newHeader || fallbackNewHeader,
    ...bodyLines,
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
