import { isCallMarkerAt, skipJsWhitespaceAndComments } from "./codeModeJsScan";

/**
 * Nested tools that already have specialized timeline presentation.
 * They should not be re-listed as generic tool-name previews.
 */
const SPECIALIZED_NESTED_TOOLS = new Set([
  "exec_command",
  "apply_patch",
  "write_stdin",
  "update_plan",
]);

type NamespacePrefix = {
  root: "tools" | "functions";
  dotted: "tools." | "functions.";
};

const NAMESPACES: NamespacePrefix[] = [
  { root: "tools", dotted: "tools." },
  { root: "functions", dotted: "functions." },
];

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
 * Format a code-mode nested tool name for timeline previews.
 * `mcp__ibrain__ibrain_get_run` → `ibrain/ibrain_get_run`
 */
export function formatNestedToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const separator = rest.indexOf("__");
    if (separator > 0) {
      const server = rest.slice(0, separator);
      const tool = rest.slice(separator + 2);
      if (server && tool) {
        return `${server}/${tool}`;
      }
    }
  }
  return name;
}

function nextNamespaceCall(
  scriptText: string,
  searchFrom: number,
): { rootIndex: number; dotted: NamespacePrefix["dotted"] } | null {
  let best: { rootIndex: number; dotted: NamespacePrefix["dotted"] } | null = null;

  for (const ns of NAMESPACES) {
    let from = searchFrom;
    while (from < scriptText.length) {
      const found = scriptText.indexOf(ns.dotted, from);
      if (found === -1) {
        break;
      }
      if (!isCallMarkerAt(scriptText, found, ns.root)) {
        from = found + ns.dotted.length;
        continue;
      }
      if (!best || found < best.rootIndex) {
        best = { rootIndex: found, dotted: ns.dotted };
      }
      break;
    }
  }

  return best;
}

/**
 * Extract nested `tools.<name>(...)` / `functions.<name>(...)` call names from a
 * code-mode exec script, excluding specialized shell/patch/plan helpers.
 */
export function extractNestedToolCallNames(scriptText: string): string[] {
  if (!scriptText.trim()) {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();
  let searchFrom = 0;

  while (searchFrom < scriptText.length) {
    const found = nextNamespaceCall(scriptText, searchFrom);
    if (!found) {
      break;
    }

    const nameStart = found.rootIndex + found.dotted.length;
    const identifier = readIdentifier(scriptText, nameStart);
    if (!identifier) {
      searchFrom = nameStart;
      continue;
    }

    let index = skipJsWhitespaceAndComments(scriptText, identifier.endIndex);
    if (scriptText[index] !== "(") {
      searchFrom = identifier.endIndex;
      continue;
    }

    if (SPECIALIZED_NESTED_TOOLS.has(identifier.name)) {
      searchFrom = index + 1;
      continue;
    }

    if (!seen.has(identifier.name)) {
      seen.add(identifier.name);
      names.push(identifier.name);
    }
    searchFrom = index + 1;
  }

  return names;
}

/** Human-readable summary of non-specialized nested tool calls. */
export function summarizeNestedToolCalls(scriptText: string): string {
  const names = extractNestedToolCallNames(scriptText);
  if (names.length === 0) {
    return "";
  }
  return names.map(formatNestedToolName).join(", ");
}
