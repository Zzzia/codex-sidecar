import type {
  ParsedCommand,
  ToolResultPayload,
} from "../../shared/types.js";

type ParsedCodexCommandOutput = {
  chunkId?: string;
  wallTimeSeconds?: number;
  exitCode: number | null;
  processId?: string;
  outputLineCount?: number;
  outputText: string;
  stderrText: string;
  rawOutput?: string;
};

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFromField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFromField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function parseExitCodeFromOutput(outputText: string): number | null {
  const match = outputText.match(/(?:Process exited with code|Exit code:) (-?\d+)/);
  if (!match?.[1]) {
    return null;
  }

  return parseInteger(match[1]);
}

function parseTextCodexCommandOutput(rawOutput: string): ParsedCodexCommandOutput | null {
  const normalized = rawOutput.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const outputMarker = "Output:";
  const markerIndex = normalized.indexOf(outputMarker);
  if (markerIndex === -1) {
    return null;
  }

  const headerText = normalized.slice(0, markerIndex);
  const outputText = normalized.slice(markerIndex + outputMarker.length).replace(/^\n/, "");
  const headerLines = headerText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!headerLines.some((line) => line.startsWith("Wall time: "))) {
    return null;
  }

  const parsed: ParsedCodexCommandOutput = {
    exitCode: null,
    outputText,
    stderrText: "",
    rawOutput,
  };

  for (const line of headerLines) {
    let match = line.match(/^Total output lines: (\d+)$/);
    if (match?.[1]) {
      parsed.outputLineCount = parseInteger(match[1]) ?? undefined;
      continue;
    }

    match = line.match(/^Chunk ID: (.+)$/);
    if (match?.[1]) {
      parsed.chunkId = match[1];
      continue;
    }

    match = line.match(/^Wall time: (-?\d+(?:\.\d+)?) seconds$/);
    if (match?.[1]) {
      parsed.wallTimeSeconds = parseNumber(match[1]) ?? undefined;
      continue;
    }

    match = line.match(/^(?:Process exited with code|Exit code:) (-?\d+)$/);
    if (match?.[1]) {
      parsed.exitCode = parseInteger(match[1]);
      continue;
    }

    match = line.match(/^Process running with session ID (.+)$/);
    if (match?.[1]) {
      parsed.processId = match[1];
      continue;
    }

    if (/^Original token count: \d+$/.test(line)) {
      continue;
    }

    return null;
  }

  return parsed;
}

function parseStructuredCodexCommandOutput(
  data: Record<string, unknown>,
): ParsedCodexCommandOutput | null {
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const outputText = typeof data.output === "string" ? data.output : "";
  const stderrText = typeof data.stderr === "string" ? data.stderr : "";
  const exitCode =
    numberFromField(data.exit_code) ??
    numberFromField(metadata.exit_code) ??
    null;
  const processId =
    stringFromField(data.session_id) ?? stringFromField(data.process_id);
  const wallTimeSeconds = numberFromField(data.wall_time_seconds);
  const outputLineCount =
    numberFromField(data.total_output_lines) ??
    numberFromField(data.output_line_count);

  if (
    !outputText &&
    !stderrText &&
    exitCode === null &&
    !processId &&
    wallTimeSeconds === undefined &&
    outputLineCount === undefined
  ) {
    return null;
  }

  return {
    wallTimeSeconds,
    exitCode,
    processId,
    outputLineCount,
    outputText,
    stderrText,
  };
}

function parseExecCommandFunctionOutput(
  parsed: unknown,
  rawOutput: string,
): ParsedCodexCommandOutput | null {
  if (parsed && typeof parsed === "object") {
    const structured = parseStructuredCodexCommandOutput(
      parsed as Record<string, unknown>,
    );
    if (structured) {
      return structured;
    }
  }

  return rawOutput ? parseTextCodexCommandOutput(rawOutput) : null;
}

function processIdFromInvocationArguments(argumentsText: string): string | undefined {
  if (!argumentsText.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const args = parsed as Record<string, unknown>;
    return stringFromField(args.session_id) ?? stringFromField(args.process_id);
  } catch {
    return undefined;
  }
}

function flattenCodeModeOutputParts(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("");
}

function parseCodeModeScriptOutput(
  parsed: unknown,
  rawOutput: string,
): ParsedCodexCommandOutput | null {
  const flattened =
    flattenCodeModeOutputParts(parsed) ||
    (typeof rawOutput === "string" ? rawOutput : "");
  if (!flattened.trim()) {
    return null;
  }

  // Prefer nested exec_command JSON chunks; ignore freeform script headers.
  if (Array.isArray(parsed)) {
    const chunkOutputs: string[] = [];
    let exitCode: number | null = null;
    let wallTimeSeconds: number | undefined;
    let processId: string | undefined;

    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const text = (entry as Record<string, unknown>).text;
      if (typeof text !== "string" || !text.trim()) {
        continue;
      }

      const asJson = parseJsonString(text);
      if (!asJson || typeof asJson !== "object" || Array.isArray(asJson)) {
        continue;
      }

      const record = asJson as Record<string, unknown>;
      if (typeof record.output === "string") {
        chunkOutputs.push(record.output);
      }
      exitCode = numberFromField(record.exit_code) ?? exitCode;
      wallTimeSeconds =
        numberFromField(record.wall_time_seconds) ?? wallTimeSeconds;
      processId =
        stringFromField(record.session_id) ??
        stringFromField(record.process_id) ??
        processId;
    }

    if (chunkOutputs.length > 0) {
      return {
        exitCode,
        wallTimeSeconds,
        processId,
        outputText: chunkOutputs.join("\n"),
        stderrText: "",
        rawOutput: flattened,
      };
    }
  }

  const textParsed = parseTextCodexCommandOutput(flattened);
  if (textParsed) {
    return textParsed;
  }

  return {
    exitCode: parseExitCodeFromOutput(flattened),
    outputText: flattened,
    stderrText: "",
    rawOutput: flattened,
  };
}

export function normalizeToolOutput(
  payload: Record<string, unknown>,
  fallbackTitle: string,
  invocationArgumentsText = "",
): ToolResultPayload {
  const rawOutput = typeof payload.output === "string" ? payload.output : "";
  const parsed = parseJsonString(payload.output);
  const data =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const isShellResultTool =
    fallbackTitle === "exec_command" ||
    fallbackTitle === "write_stdin" ||
    fallbackTitle === "exec";
  const execOutput = isShellResultTool
    ? fallbackTitle === "exec"
      ? parseCodeModeScriptOutput(parsed, rawOutput)
      : parseExecCommandFunctionOutput(parsed, rawOutput)
    : null;
  const invocationProcessId =
    fallbackTitle === "write_stdin"
      ? processIdFromInvocationArguments(invocationArgumentsText)
      : undefined;
  const outputText = execOutput
    ? execOutput.outputText
    : (typeof data.output === "string" ? data.output : "") ||
      flattenCodeModeOutputParts(parsed) ||
      rawOutput;
  const stderrText =
    execOutput?.stderrText ?? (typeof data.stderr === "string" ? data.stderr : "");
  const exitCode =
    execOutput?.exitCode ??
    numberFromField(data.exit_code) ??
    numberFromField(metadata.exit_code) ??
    parseExitCodeFromOutput(rawOutput || flattenCodeModeOutputParts(parsed));

  return {
    toolType:
      payload.type === "custom_tool_call_output"
        ? "custom_tool_call_output"
        : "function_call_output",
    title: fallbackTitle,
    success: exitCode === null ? null : exitCode === 0,
    exitCode,
    outputText,
    stderrText,
    parsedCommands: [],
    raw: execOutput ? { ...execOutput, rawOutput: execOutput.rawOutput ?? rawOutput } : parsed,
    processId: execOutput?.processId ?? invocationProcessId,
    wallTimeSeconds: execOutput?.wallTimeSeconds,
    outputLineCount: execOutput?.outputLineCount,
  };
}

export function normalizeParsedCommands(value: unknown): ParsedCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const type = record.type;
      const cmd = typeof record.cmd === "string" ? record.cmd : "";

      if (type === "read") {
        const name = typeof record.name === "string" ? record.name : "";
        const filePath = typeof record.path === "string" ? record.path : "";
        if (!name || !filePath) {
          return null;
        }
        return {
          type,
          cmd,
          name,
          path: filePath,
        } satisfies ParsedCommand;
      }

      if (type === "search") {
        return {
          type,
          cmd,
          query: typeof record.query === "string" ? record.query : null,
          path: typeof record.path === "string" ? record.path : null,
        } satisfies ParsedCommand;
      }

      if (type === "list_files") {
        return {
          type,
          cmd,
          path: typeof record.path === "string" ? record.path : null,
        } satisfies ParsedCommand;
      }

      if (type === "unknown") {
        return {
          type,
          cmd,
        } satisfies ParsedCommand;
      }

      return null;
    })
    .filter((entry): entry is ParsedCommand => Boolean(entry));
}

export function normalizeExecResult(
  payload: Record<string, unknown>,
  fallbackTitle: string,
): ToolResultPayload {
  const formattedOutput =
    typeof payload.formatted_output === "string"
      ? parseTextCodexCommandOutput(payload.formatted_output)
      : null;
  const exitCode =
    numberFromField(payload.exit_code) ?? formattedOutput?.exitCode ?? null;
  const outputText =
    typeof payload.aggregated_output === "string"
      ? payload.aggregated_output
      : typeof payload.stdout === "string"
        ? payload.stdout
        : formattedOutput?.outputText ?? "";

  return {
    toolType: "exec_command_end",
    title: fallbackTitle,
    success: exitCode === null ? null : exitCode === 0,
    exitCode,
    outputText,
    stderrText: typeof payload.stderr === "string" ? payload.stderr : "",
    parsedCommands: normalizeParsedCommands(payload.parsed_cmd),
    raw: payload,
    processId: stringFromField(payload.process_id) ?? formattedOutput?.processId,
    wallTimeSeconds: formattedOutput?.wallTimeSeconds,
    outputLineCount: formattedOutput?.outputLineCount,
  };
}
