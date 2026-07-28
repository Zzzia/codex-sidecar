import type { ToolResultPayload } from "@shared/types";
import {
  isShellToolName,
  shellCommandTextFromInvocation,
} from "./commandSemantics";
import { compactWhitespace, stripShellWrapper } from "./shellParsing";

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function patchPreview(patchText: string): string {
  const matches = [...patchText.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)];
  if (matches.length === 0) {
    return "View patch";
  }
  if (matches.length === 1) {
    return matches[0]?.[1] ?? "View patch";
  }
  return `${matches[0]?.[1] ?? "patch"} and ${matches.length} files`;
}

export function commandTextFromResult(result: ToolResultPayload): string {
  if (!result.raw || typeof result.raw !== "object") {
    return "";
  }

  const raw = result.raw as { command?: string[] | string };
  if (typeof raw.command === "string" && raw.command.trim()) {
    return stripShellWrapper(raw.command);
  }

  if (Array.isArray(raw.command) && raw.command.length > 0) {
    return stripShellWrapper(raw.command.join(" "));
  }

  return "";
}

export function toolPreview(name: string, invocationText: string): string {
  if (!invocationText.trim()) {
    return name;
  }

  if (isShellToolName(name)) {
    const commandText = shellCommandTextFromInvocation(name, invocationText);
    if (commandText) {
      return commandText;
    }
  }

  if (name === "apply_patch") {
    return patchPreview(invocationText);
  }

  const parsed = tryParseJson(invocationText);
  if (parsed) {
    if (typeof parsed.cmd === "string" && parsed.cmd.trim()) {
      return stripShellWrapper(parsed.cmd);
    }

    return compactWhitespace(JSON.stringify(parsed));
  }

  return compactWhitespace(invocationText);
}
