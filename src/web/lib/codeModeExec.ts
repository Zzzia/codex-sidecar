import { stripShellWrapper } from "./shellParsing";

function readJsStringLiteral(
  source: string,
  startIndex: number,
): { value: string; endIndex: number } | null {
  const quote = source[startIndex];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }

  let index = startIndex + 1;
  let value = "";
  let escapeNext = false;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (escapeNext) {
      if (char === "n") {
        value += "\n";
      } else if (char === "r") {
        value += "\r";
      } else if (char === "t") {
        value += "\t";
      } else {
        value += char;
      }
      escapeNext = false;
      index += 1;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      index += 1;
      continue;
    }

    if (char === quote) {
      return { value, endIndex: index + 1 };
    }

    // Template literals with ${...} are not shell cmds we support for classification.
    if (quote === "`" && char === "$" && source[index + 1] === "{") {
      return null;
    }

    value += char;
    index += 1;
  }

  return null;
}

function skipJsWhitespaceAndComments(source: string, startIndex: number): number {
  let index = startIndex;
  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }

    break;
  }
  return index;
}

function readBalancedJsObject(
  source: string,
  openBraceIndex: number,
): { text: string; endIndex: number } | null {
  if (source[openBraceIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let index = openBraceIndex;
  let quote: '"' | "'" | "`" | null = null;
  let escapeNext = false;

  while (index < source.length) {
    const char = source[index] ?? "";

    if (quote) {
      if (escapeNext) {
        escapeNext = false;
        index += 1;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          text: source.slice(openBraceIndex, index + 1),
          endIndex: index + 1,
        };
      }
    }

    index += 1;
  }

  return null;
}

function skipJsValue(source: string, startIndex: number): number | null {
  const valueStart = source[startIndex] ?? "";
  if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
    const literal = readJsStringLiteral(source, startIndex);
    return literal ? literal.endIndex : null;
  }

  if (valueStart === "{") {
    const nested = readBalancedJsObject(source, startIndex);
    return nested ? nested.endIndex : null;
  }

  if (valueStart === "[") {
    let depth = 0;
    let index = startIndex;
    let quote: '"' | "'" | "`" | null = null;
    let escapeNext = false;
    while (index < source.length) {
      const char = source[index] ?? "";
      if (quote) {
        if (escapeNext) {
          escapeNext = false;
        } else if (char === "\\") {
          escapeNext = true;
        } else if (char === quote) {
          quote = null;
        }
        index += 1;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        index += 1;
        continue;
      }
      if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        index += 1;
        if (depth === 0) {
          return index;
        }
        continue;
      }
      index += 1;
    }
    return null;
  }

  let index = startIndex;
  while (index < source.length && source[index] !== "," && source[index] !== "}") {
    index += 1;
  }
  return index;
}

function extractCmdFromObjectLiteral(objectText: string): string | null {
  let index = 1; // skip leading '{'
  while (index < objectText.length) {
    index = skipJsWhitespaceAndComments(objectText, index);
    if (index >= objectText.length || objectText[index] === "}") {
      break;
    }

    let key: string | null = null;
    const keyStart = objectText[index] ?? "";
    if (keyStart === '"' || keyStart === "'" || keyStart === "`") {
      const literal = readJsStringLiteral(objectText, index);
      if (!literal) {
        return null;
      }
      key = literal.value;
      index = literal.endIndex;
    } else if (/[A-Za-z_$]/.test(keyStart)) {
      let end = index + 1;
      while (end < objectText.length && /[A-Za-z0-9_$]/.test(objectText[end] ?? "")) {
        end += 1;
      }
      key = objectText.slice(index, end);
      index = end;
    } else {
      // Unexpected token; stop rather than guessing.
      break;
    }

    index = skipJsWhitespaceAndComments(objectText, index);
    if (objectText[index] !== ":") {
      break;
    }
    index += 1;
    index = skipJsWhitespaceAndComments(objectText, index);

    if (key === "cmd") {
      const literal = readJsStringLiteral(objectText, index);
      if (literal && literal.value.trim()) {
        return literal.value;
      }
      return null;
    }

    const nextIndex = skipJsValue(objectText, index);
    if (nextIndex === null) {
      return null;
    }
    index = nextIndex;

    index = skipJsWhitespaceAndComments(objectText, index);
    if (objectText[index] === ",") {
      index += 1;
    }
  }

  return null;
}

/**
 * Extract shell cmds nested in Codex code-mode `exec` scripts, e.g.
 * `tools.exec_command({ cmd: "rg -n foo", ... })`.
 *
 * Uses a small structural scanner over JS object literals rather than
 * regex-matching command text — the only fixed API surface is the
 * `tools.exec_command(` call shape that Codex code-mode emits.
 */
export function extractNestedExecCommandTexts(scriptText: string): string[] {
  const marker = "tools.exec_command";
  const commands: string[] = [];
  let searchFrom = 0;

  while (searchFrom < scriptText.length) {
    const markerIndex = scriptText.indexOf(marker, searchFrom);
    if (markerIndex === -1) {
      break;
    }

    // Reject identifier prefixes so we only match the nested API call.
    const before = markerIndex > 0 ? scriptText[markerIndex - 1] ?? "" : "";
    if (before && /[A-Za-z0-9_$]/.test(before)) {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    let index = skipJsWhitespaceAndComments(scriptText, markerIndex + marker.length);
    if (scriptText[index] !== "(") {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    index = skipJsWhitespaceAndComments(scriptText, index + 1);
    if (scriptText[index] !== "{") {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    const objectLiteral = readBalancedJsObject(scriptText, index);
    if (!objectLiteral) {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    const cmd = extractCmdFromObjectLiteral(objectLiteral.text);
    if (cmd) {
      commands.push(stripShellWrapper(cmd));
    }
    searchFrom = objectLiteral.endIndex;
  }

  return commands;
}
