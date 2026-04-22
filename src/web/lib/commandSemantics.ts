import type { ParsedCommand } from "@shared/types";
import {
  commandBasename,
  compactWhitespace,
  positionalOperands,
  shellJoin,
  shortDisplayPath,
  splitSegments,
  stripShellWrapper,
  tokenizeShell,
} from "./shellParsing";

export type ParsedExecCommand = ParsedCommand;

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

function parseGrepLike(headTokens: string[], args: string[]): ParsedExecCommand {
  const flagsWithValues = new Set([
    "-e",
    "--regexp",
    "-f",
    "--file",
    "-g",
    "--glob",
    "-t",
    "--type",
    "-m",
    "--max-count",
    "-C",
    "--context",
    "-A",
    "--after-context",
    "-B",
    "--before-context",
  ]);

  const operands: string[] = [];
  let query: string | null = null;
  let afterDoubleDash = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (!token) {
      continue;
    }

    if (afterDoubleDash) {
      operands.push(token);
      continue;
    }

    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (token === "-e" || token === "--regexp" || token === "-f" || token === "--file") {
      const value = args[index + 1] ?? null;
      if (!query && value) {
        query = value;
      }
      index += 1;
      continue;
    }

    if (flagsWithValues.has(token)) {
      index += 1;
      continue;
    }

    if (token.startsWith("--") && token.includes("=")) {
      continue;
    }

    if (token.startsWith("-")) {
      continue;
    }

    operands.push(token);
  }

  const normalizedQuery = query ?? operands[0] ?? null;
  const pathIndex = query ? 0 : 1;
  const pathValue = operands[pathIndex] ?? null;

  return {
    type: "search",
    cmd: shellJoin([...headTokens, ...args]),
    query: normalizedQuery,
    path: pathValue ? shortDisplayPath(pathValue) : null,
  };
}

function parseReadCommand(head: string, args: string[]): ParsedExecCommand | null {
  const readFlags = new Set(["-n", "-c"]);
  const operands = positionalOperands(args, readFlags);
  const candidate = operands.at(-1);
  if (!candidate) {
    return null;
  }

  return {
    type: "read",
    cmd: shellJoin([head, ...args]),
    name: shortDisplayPath(candidate),
    path: candidate,
  };
}

function parseSed(args: string[]): ParsedExecCommand | null {
  if (!args.includes("-n")) {
    return null;
  }

  const operands = positionalOperands(args, new Set(["-e", "--expression", "-f", "--file"]));
  const filePath = operands.at(-1);
  if (!filePath) {
    return null;
  }

  return {
    type: "read",
    cmd: shellJoin(["sed", ...args]),
    name: shortDisplayPath(filePath),
    path: filePath,
  };
}

function parseFind(args: string[]): ParsedExecCommand {
  const nameFlags = new Set(["-name", "-iname", "-path", "-ipath"]);
  let query: string | null = null;
  let pathValue: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (!token) {
      continue;
    }

    if (nameFlags.has(token)) {
      query = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (!pathValue && !token.startsWith("-")) {
      pathValue = token;
    }
  }

  if (query) {
    return {
      type: "search",
      cmd: shellJoin(["find", ...args]),
      query,
      path: pathValue ? shortDisplayPath(pathValue) : null,
    };
  }

  return {
    type: "list_files",
    cmd: shellJoin(["find", ...args]),
    path: pathValue ? shortDisplayPath(pathValue) : ".",
  };
}

function parseFd(head: string, args: string[]): ParsedExecCommand {
  const operands = positionalOperands(
    args,
    new Set([
      "-g",
      "--glob",
      "-t",
      "--type",
      "-e",
      "--extension",
      "-x",
      "--exec",
      "-E",
      "--exclude",
      "-d",
      "--max-depth",
      "-c",
      "--color",
      "-j",
      "--threads",
    ]),
  );

  if (operands.length >= 2) {
    return {
      type: "search",
      cmd: shellJoin([head, ...args]),
      query: operands[0] ?? null,
      path: shortDisplayPath(operands[1] ?? "."),
    };
  }

  if (operands.length === 1) {
    return {
      type: "search",
      cmd: shellJoin([head, ...args]),
      query: operands[0] ?? null,
      path: null,
    };
  }

  return {
    type: "list_files",
    cmd: shellJoin([head, ...args]),
    path: ".",
  };
}

function parseSegment(tokens: string[]): ParsedExecCommand | null {
  if (tokens.length === 0) {
    return null;
  }

  const [head = "", ...args] = tokens;
  const headName = commandBasename(head);
  if (!head || head === "cd") {
    return null;
  }

  if (
    (headName === "bash" || headName === "zsh" || headName === "sh") &&
    (args[0] === "-c" || args[0] === "-lc")
  ) {
    return parseExecCommand(args.slice(1).join(" "))[0] ?? {
      type: "unknown",
      cmd: compactWhitespace(tokens.join(" ")),
    };
  }

  if (headName === "git" && args[0] === "grep") {
    return parseGrepLike(["git", "grep"], args.slice(1));
  }

  if (
    headName === "rg" ||
    headName === "ripgrep" ||
    headName === "grep" ||
    headName === "ag"
  ) {
    if (args.includes("--files")) {
      const operands = positionalOperands(args, new Set(["-g", "--glob", "-t", "--type"]));
      return {
        type: "list_files",
        cmd: shellJoin([headName, ...args]),
        path: operands[0] ? shortDisplayPath(operands[0]) : ".",
      };
    }
    return parseGrepLike([headName], args);
  }

  if (headName === "ls" || headName === "tree") {
    const operands = positionalOperands(args, new Set(["-I", "-L"]));
    return {
      type: "list_files",
      cmd: shellJoin([headName, ...args]),
      path: operands[0] ? shortDisplayPath(operands[0]) : ".",
    };
  }

  if (headName === "find") {
    return parseFind(args);
  }

  if (headName === "fd" || headName === "fdfind") {
    return parseFd(headName, args);
  }

  if (headName === "sed") {
    return parseSed(args);
  }

  if (
    ["cat", "bat", "batcat", "glow", "head", "tail", "more", "less", "nl"].includes(headName)
  ) {
    return parseReadCommand(headName, args);
  }

  return {
    type: "unknown",
    cmd: shellJoin(tokens),
  };
}

export function extractExecCommandText(invocationText: string): string {
  if (!invocationText.trim()) {
    return "";
  }

  const parsed = tryParseJson(invocationText);
  const command = parsed?.cmd;
  if (typeof command === "string" && command.trim()) {
    return stripShellWrapper(command);
  }

  return stripShellWrapper(invocationText);
}

export function parseExecCommand(commandText: string): ParsedExecCommand[] {
  const normalized = compactWhitespace(commandText);
  if (!normalized) {
    return [];
  }

  const segments = splitSegments(tokenizeShell(normalized));
  if (segments.length === 0) {
    return [];
  }

  const parsed = segments
    .map((segment) => parseSegment(segment))
    .filter((entry): entry is ParsedExecCommand => Boolean(entry));

  return parsed.length > 0
    ? parsed
    : [
        {
          type: "unknown",
          cmd: normalized,
        },
      ];
}

export function isExplorationCommand(
  command: ParsedExecCommand,
): command is Exclude<ParsedExecCommand, { type: "unknown" }> {
  return command.type !== "unknown";
}
