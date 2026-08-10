import type { PatchChange } from "@shared/types";
import {
  isCallMarkerAt,
  readJsStringLiteral,
  skipJsWhitespaceAndComments,
} from "./codeModeJsScan";

export interface NestedApplyPatch {
  patchText: string;
}

const APPLY_PATCH_MARKERS = ["tools.apply_patch", "functions.apply_patch"] as const;

function readIdentifier(
  source: string,
  startIndex: number,
): { name: string; endIndex: number } | null {
  if (!/[A-Za-z_$]/.test(source[startIndex] ?? "")) {
    return null;
  }
  let end = startIndex + 1;
  while (end < source.length && /[A-Za-z0-9_$]/.test(source[end] ?? "")) {
    end += 1;
  }
  return {
    name: source.slice(startIndex, end),
    endIndex: end,
  };
}

/**
 * Find `name = "..." | '...' | \`...\`` assignments (const/let/var optional).
 */
export function findAssignedStringLiteral(
  scriptText: string,
  name: string,
): string | null {
  const marker = name;
  let searchFrom = 0;

  while (searchFrom < scriptText.length) {
    const nameIndex = scriptText.indexOf(marker, searchFrom);
    if (nameIndex === -1) {
      return null;
    }

    const before = nameIndex > 0 ? scriptText[nameIndex - 1] ?? "" : "";
    const after = scriptText[nameIndex + marker.length] ?? "";
    if (
      (before && /[A-Za-z0-9_$]/.test(before)) ||
      (after && /[A-Za-z0-9_$]/.test(after))
    ) {
      searchFrom = nameIndex + marker.length;
      continue;
    }

    let index = skipJsWhitespaceAndComments(
      scriptText,
      nameIndex + marker.length,
    );
    if (scriptText[index] !== "=") {
      searchFrom = nameIndex + marker.length;
      continue;
    }
    index = skipJsWhitespaceAndComments(scriptText, index + 1);
    const quote = scriptText[index] ?? "";
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      searchFrom = nameIndex + marker.length;
      continue;
    }

    const literal = readJsStringLiteral(scriptText, index);
    if (!literal || !literal.value.trim()) {
      searchFrom = nameIndex + marker.length;
      continue;
    }
    return literal.value;
  }

  return null;
}

function nextApplyPatchMarker(
  scriptText: string,
  searchFrom: number,
): { markerIndex: number; marker: string } | null {
  let markerIndex = -1;
  let marker = "";
  for (const candidate of APPLY_PATCH_MARKERS) {
    const found = scriptText.indexOf(candidate, searchFrom);
    if (found === -1) {
      continue;
    }
    if (markerIndex === -1 || found < markerIndex) {
      markerIndex = found;
      marker = candidate;
    }
  }
  if (markerIndex === -1 || !marker) {
    return null;
  }
  return { markerIndex, marker };
}

function resolvePatchArgument(
  scriptText: string,
  argStart: number,
): { patchText: string | null; endIndex: number } {
  const quote = scriptText[argStart] ?? "";
  if (quote === '"' || quote === "'" || quote === "`") {
    const literal = readJsStringLiteral(scriptText, argStart);
    if (!literal) {
      return { patchText: null, endIndex: argStart + 1 };
    }
    return {
      patchText: literal.value.trim() ? literal.value : null,
      endIndex: literal.endIndex,
    };
  }

  const identifier = readIdentifier(scriptText, argStart);
  if (!identifier) {
    return { patchText: null, endIndex: argStart + 1 };
  }

  const assigned = findAssignedStringLiteral(scriptText, identifier.name);
  return {
    patchText: assigned && assigned.trim() ? assigned : null,
    endIndex: identifier.endIndex,
  };
}

/**
 * Extract nested tools.apply_patch(...) payloads from code-mode exec scripts.
 * Supports string literals and nearby `const patch = "..."` references.
 */
export function extractNestedApplyPatches(scriptText: string): NestedApplyPatch[] {
  if (!scriptText.trim()) {
    return [];
  }

  const patches: NestedApplyPatch[] = [];
  let searchFrom = 0;

  while (searchFrom < scriptText.length) {
    const found = nextApplyPatchMarker(scriptText, searchFrom);
    if (!found) {
      break;
    }

    const { markerIndex, marker } = found;
    if (!isCallMarkerAt(scriptText, markerIndex, marker)) {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    let index = skipJsWhitespaceAndComments(
      scriptText,
      markerIndex + marker.length,
    );
    if (scriptText[index] !== "(") {
      searchFrom = markerIndex + marker.length;
      continue;
    }
    index = skipJsWhitespaceAndComments(scriptText, index + 1);

    const resolved = resolvePatchArgument(scriptText, index);
    if (resolved.patchText) {
      patches.push({ patchText: resolved.patchText });
    }
    searchFrom = Math.max(resolved.endIndex, markerIndex + marker.length);
  }

  return patches;
}

/** True when the script invokes apply_patch at least once (even if args unresolved). */
export function hasNestedApplyPatchCall(scriptText: string): boolean {
  if (!scriptText.trim()) {
    return false;
  }

  let searchFrom = 0;
  while (searchFrom < scriptText.length) {
    const found = nextApplyPatchMarker(scriptText, searchFrom);
    if (!found) {
      return false;
    }
    if (isCallMarkerAt(scriptText, found.markerIndex, found.marker)) {
      let index = skipJsWhitespaceAndComments(
        scriptText,
        found.markerIndex + found.marker.length,
      );
      if (scriptText[index] === "(") {
        return true;
      }
    }
    searchFrom = found.markerIndex + found.marker.length;
  }
  return false;
}

/**
 * True when a code-mode exec script only applies patches (plus harmless text())
 * and has no nested shell / write_stdin work for the timeline body.
 */
export function isApplyPatchOnlyCodeModeScript(
  scriptText: string,
  hasNestedShellOrWriteWork: boolean,
): boolean {
  if (hasNestedShellOrWriteWork) {
    return false;
  }
  return hasNestedApplyPatchCall(scriptText);
}

export function patchFilePathsFromInvocation(patchText: string): string[] {
  const paths: string[] = [];
  for (const match of patchText.matchAll(
    /\*\*\* (?:Add|Update|Delete) File: (.+)/g,
  )) {
    const filePath = match[1]?.trim();
    if (filePath) {
      paths.push(filePath);
    }
  }
  return paths;
}

function displayPathFromAbsolute(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts.at(-1) || filePath;
}

function flushPatchSection(
  changes: PatchChange[],
  section: {
    changeType: string;
    path: string;
    bodyLines: string[];
  } | null,
): void {
  if (!section) {
    return;
  }

  const displayPath = displayPathFromAbsolute(section.path);
  let unifiedDiff = "";

  if (section.changeType === "add") {
    const contentLines = section.bodyLines.map((line) =>
      line.startsWith("+") ? line.slice(1) : line,
    );
    unifiedDiff = [
      "--- /dev/null",
      `+++ b/${displayPath}`,
      `@@ -0,0 +1,${contentLines.length} @@`,
      ...contentLines.map((line) => `+${line}`),
    ].join("\n");
  } else if (section.changeType === "delete") {
    const contentLines = section.bodyLines.map((line) =>
      line.startsWith("-") ? line.slice(1) : line,
    );
    if (contentLines.length > 0) {
      unifiedDiff = [
        `--- a/${displayPath}`,
        "+++ /dev/null",
        `@@ -1,${contentLines.length} +0,0 @@`,
        ...contentLines.map((line) => `-${line}`),
      ].join("\n");
    } else {
      unifiedDiff = [`--- a/${displayPath}`, "+++ /dev/null", "@@ -0,0 +0,0 @@"].join(
        "\n",
      );
    }
  } else {
    const body = section.bodyLines.join("\n").trim();
    if (body) {
      const hasHeaders =
        body.includes("\n--- ") || body.startsWith("--- ") || body.includes("\n+++ ");
      unifiedDiff = hasHeaders
        ? body
        : [`--- a/${displayPath}`, `+++ b/${displayPath}`, body].join("\n");
    }
  }

  changes.push({
    path: section.path,
    displayPath,
    changeType: section.changeType,
    unifiedDiff,
  });
}

/**
 * Best-effort conversion of Codex Begin Patch text into PatchChange rows so the
 * timeline can preview before patch_apply_end arrives.
 */
export function patchChangesFromInvocation(patchText: string): PatchChange[] {
  if (!patchText.trim()) {
    return [];
  }

  const lines = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const changes: PatchChange[] = [];
  let section: {
    changeType: string;
    path: string;
    bodyLines: string[];
  } | null = null;

  for (const line of lines) {
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch")) {
      if (line.startsWith("*** End Patch")) {
        flushPatchSection(changes, section);
        section = null;
      }
      continue;
    }

    const addMatch = /^\*\*\* Add File: (.+)$/.exec(line);
    if (addMatch) {
      flushPatchSection(changes, section);
      section = {
        changeType: "add",
        path: addMatch[1]?.trim() || "",
        bodyLines: [],
      };
      continue;
    }

    const updateMatch = /^\*\*\* Update File: (.+)$/.exec(line);
    if (updateMatch) {
      flushPatchSection(changes, section);
      section = {
        changeType: "update",
        path: updateMatch[1]?.trim() || "",
        bodyLines: [],
      };
      continue;
    }

    const deleteMatch = /^\*\*\* Delete File: (.+)$/.exec(line);
    if (deleteMatch) {
      flushPatchSection(changes, section);
      section = {
        changeType: "delete",
        path: deleteMatch[1]?.trim() || "",
        bodyLines: [],
      };
      continue;
    }

    if (section) {
      section.bodyLines.push(line);
    }
  }

  flushPatchSection(changes, section);
  return changes.filter((change) => change.path);
}

export function summarizePatchInvocation(patchText: string): string {
  const paths = patchFilePathsFromInvocation(patchText);
  if (paths.length === 0) {
    return "Code changes";
  }
  if (paths.length === 1) {
    return displayPathFromAbsolute(paths[0] ?? "file");
  }
  const first = displayPathFromAbsolute(paths[0] ?? "file");
  return `${first} and ${paths.length - 1} more`;
}
