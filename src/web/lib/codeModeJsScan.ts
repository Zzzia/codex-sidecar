/** Shared low-level JS-ish scanners for code-mode freeform scripts. */

export type JsLiteral = { value: string; endIndex: number; isTemplate: boolean };

export function readJsStringLiteral(
  source: string,
  startIndex: number,
): JsLiteral | null {
  const quote = source[startIndex];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }

  let index = startIndex + 1;
  let value = "";
  let escapeNext = false;
  const isTemplate = quote === "`";

  while (index < source.length) {
    const char = source[index] ?? "";
    if (escapeNext) {
      if (char === "n") {
        value += "\n";
      } else if (char === "r") {
        value += "\r";
      } else if (char === "t") {
        value += "\t";
      } else if (char === "u" && /^[0-9a-fA-F]{4}/.test(source.slice(index + 1, index + 5))) {
        const hex = source.slice(index + 1, index + 5);
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        escapeNext = false;
        continue;
      } else if (char === "x" && /^[0-9a-fA-F]{2}/.test(source.slice(index + 1, index + 3))) {
        const hex = source.slice(index + 1, index + 3);
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 3;
        escapeNext = false;
        continue;
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
      return { value, endIndex: index + 1, isTemplate };
    }

    if (quote === "`" && char === "$" && source[index + 1] === "{") {
      let depth = 1;
      let cursor = index + 2;
      let expr = "";
      while (cursor < source.length && depth > 0) {
        const inner = source[cursor] ?? "";
        if (inner === "{") {
          depth += 1;
        } else if (inner === "}") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        expr += inner;
        cursor += 1;
      }
      if (depth !== 0) {
        return null;
      }
      value += `\${${expr.trim()}}`;
      index = cursor + 1;
      continue;
    }

    value += char;
    index += 1;
  }

  return null;
}

export function skipJsWhitespaceAndComments(source: string, startIndex: number): number {
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

export function readBalancedJsObject(
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
      } else if (quote === "`" && char === "$" && source[index + 1] === "{") {
        let exprDepth = 1;
        index += 2;
        while (index < source.length && exprDepth > 0) {
          if (source[index] === "{") {
            exprDepth += 1;
          } else if (source[index] === "}") {
            exprDepth -= 1;
          }
          index += 1;
        }
        continue;
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

export function skipJsValue(source: string, startIndex: number): number | null {
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
        } else if (quote === "`" && char === "$" && source[index + 1] === "{") {
          let exprDepth = 1;
          index += 2;
          while (index < source.length && exprDepth > 0) {
            if (source[index] === "{") {
              exprDepth += 1;
            } else if (source[index] === "}") {
              exprDepth -= 1;
            }
            index += 1;
          }
          continue;
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

export function isCallMarkerAt(
  scriptText: string,
  markerIndex: number,
  marker: string,
): boolean {
  const before = markerIndex > 0 ? scriptText[markerIndex - 1] ?? "" : "";
  if (before && /[A-Za-z0-9_$]/.test(before)) {
    return false;
  }
  const after = scriptText[markerIndex + marker.length] ?? "";
  if (after && /[A-Za-z0-9_$]/.test(after)) {
    return false;
  }
  return true;
}
