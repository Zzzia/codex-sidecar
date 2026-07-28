import {
  isCallMarkerAt,
  readBalancedJsObject,
  readJsStringLiteral,
  skipJsValue,
  skipJsWhitespaceAndComments,
} from "./codeModeJsScan";
import { stripShellWrapper } from "./shellParsing";

type CmdField =
  | { kind: "literal"; value: string }
  | { kind: "reference" };

function extractCmdFieldFromObjectLiteral(objectText: string): CmdField | null {
  let index = 1;
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
      break;
    }

    index = skipJsWhitespaceAndComments(objectText, index);

    if (objectText[index] !== ":") {
      if (key === "cmd" && (objectText[index] === "," || objectText[index] === "}")) {
        return { kind: "reference" };
      }
      if (objectText[index] === ",") {
        index += 1;
        continue;
      }
      if (objectText[index] === "}") {
        break;
      }
      break;
    }

    index += 1;
    index = skipJsWhitespaceAndComments(objectText, index);

    if (key === "cmd") {
      const valueStart = objectText[index] ?? "";
      if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
        const literal = readJsStringLiteral(objectText, index);
        if (literal && literal.value.trim()) {
          return { kind: "literal", value: literal.value };
        }
        return null;
      }
      if (/[A-Za-z_$]/.test(valueStart)) {
        return { kind: "reference" };
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

function collectCmdLiteralsFromObjectLiterals(scriptText: string): string[] {
  const commands: string[] = [];
  let index = 0;
  while (index < scriptText.length) {
    if (scriptText[index] !== "{") {
      index += 1;
      continue;
    }
    const objectLiteral = readBalancedJsObject(scriptText, index);
    if (!objectLiteral) {
      index += 1;
      continue;
    }
    const field = extractCmdFieldFromObjectLiteral(objectLiteral.text);
    if (field?.kind === "literal") {
      commands.push(stripShellWrapper(field.value));
    }
    index = objectLiteral.endIndex;
  }
  return commands;
}

function readArrayElements(
  source: string,
  openBracketIndex: number,
): { elements: string[]; endIndex: number } | null {
  if (source[openBracketIndex] !== "[") {
    return null;
  }

  const elements: string[] = [];
  let index = openBracketIndex + 1;
  let quote: '"' | "'" | "`" | null = null;
  let escapeNext = false;
  let depth = 1;
  let elementStart = index;

  const pushElement = (end: number) => {
    const text = source.slice(elementStart, end).trim();
    if (text) {
      elements.push(text);
    }
  };

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
    if (char === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        pushElement(index);
        return { elements, endIndex: index + 1 };
      }
      index += 1;
      continue;
    }
    if (char === "{") {
      const nested = readBalancedJsObject(source, index);
      if (!nested) {
        return null;
      }
      index = nested.endIndex;
      continue;
    }
    if (char === "," && depth === 1) {
      pushElement(index);
      index += 1;
      elementStart = index;
      continue;
    }
    index += 1;
  }
  return null;
}

function stringLiteralValue(elementText: string): string | null {
  const trimmed = elementText.trim();
  if (!trimmed) {
    return null;
  }
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return null;
  }
  const literal = readJsStringLiteral(trimmed, 0);
  if (!literal || literal.endIndex !== trimmed.length) {
    return null;
  }
  return literal.value.trim() ? literal.value : null;
}

function collectCmdLiteralsFromStringTuples(scriptText: string): string[] {
  const commands: string[] = [];
  let index = 0;
  while (index < scriptText.length) {
    if (scriptText[index] !== "[") {
      index += 1;
      continue;
    }
    const array = readArrayElements(scriptText, index);
    if (!array) {
      index += 1;
      continue;
    }
    if (array.elements.length === 2) {
      const first = stringLiteralValue(array.elements[0] ?? "");
      const second = stringLiteralValue(array.elements[1] ?? "");
      if (first !== null && second !== null) {
        commands.push(stripShellWrapper(second));
      }
    }
    index += 1;
  }
  return commands;
}

function extractStringMapCommandValues(objectText: string): string[] {
  const values: string[] = [];
  let index = 1;
  let entryCount = 0;
  let stringValueCount = 0;

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
        return [];
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
      return [];
    }

    if (
      key === "cmd" ||
      key === "workdir" ||
      key === "yield_time_ms" ||
      key === "max_output_tokens"
    ) {
      return [];
    }

    index = skipJsWhitespaceAndComments(objectText, index);
    if (objectText[index] !== ":") {
      return [];
    }
    index += 1;
    index = skipJsWhitespaceAndComments(objectText, index);

    entryCount += 1;
    const valueStart = objectText[index] ?? "";
    if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
      const literal = readJsStringLiteral(objectText, index);
      if (!literal) {
        return [];
      }
      if (literal.value.trim()) {
        values.push(literal.value);
        stringValueCount += 1;
      }
      index = literal.endIndex;
    } else {
      return [];
    }

    index = skipJsWhitespaceAndComments(objectText, index);
    if (objectText[index] === ",") {
      index += 1;
    }
  }

  if (entryCount === 0 || stringValueCount !== entryCount) {
    return [];
  }
  return values;
}

function collectCmdLiteralsFromStringMaps(scriptText: string): string[] {
  const commands: string[] = [];
  let index = 0;
  while (index < scriptText.length) {
    if (scriptText[index] !== "{") {
      index += 1;
      continue;
    }
    const objectLiteral = readBalancedJsObject(scriptText, index);
    if (!objectLiteral) {
      index += 1;
      continue;
    }
    for (const value of extractStringMapCommandValues(objectLiteral.text)) {
      commands.push(stripShellWrapper(value));
    }
    index = objectLiteral.endIndex;
  }
  return commands;
}

function collectReferencedCmdCandidates(scriptText: string): string[] {
  const fromObjects = collectCmdLiteralsFromObjectLiterals(scriptText);
  if (fromObjects.length > 0) {
    return fromObjects;
  }
  const fromTuples = collectCmdLiteralsFromStringTuples(scriptText);
  if (fromTuples.length > 0) {
    return fromTuples;
  }
  return collectCmdLiteralsFromStringMaps(scriptText);
}

function extractFromExecCommandCalls(scriptText: string): {
  literals: string[];
  sawReference: boolean;
} {
  const markers = ["tools.exec_command", "functions.exec_command"];
  const literals: string[] = [];
  let sawReference = false;
  let searchFrom = 0;

  while (searchFrom < scriptText.length) {
    let markerIndex = -1;
    let marker = "";
    for (const candidate of markers) {
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
      break;
    }
    if (!isCallMarkerAt(scriptText, markerIndex, marker)) {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    let index = skipJsWhitespaceAndComments(scriptText, markerIndex + marker.length);
    if (scriptText[index] === "(") {
      index = skipJsWhitespaceAndComments(scriptText, index + 1);
    } else {
      if (scriptText[index] === '"' || scriptText[index] === "'") {
        index += 1;
      }
      index = skipJsWhitespaceAndComments(scriptText, index);
      if (scriptText[index] === ",") {
        index = skipJsWhitespaceAndComments(scriptText, index + 1);
      } else {
        searchFrom = markerIndex + marker.length;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(scriptText[index] ?? "")) {
      sawReference = true;
      searchFrom = markerIndex + marker.length;
      continue;
    }

    if (scriptText[index] !== "{") {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    const objectLiteral = readBalancedJsObject(scriptText, index);
    if (!objectLiteral) {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    const field = extractCmdFieldFromObjectLiteral(objectLiteral.text);
    if (field?.kind === "literal") {
      literals.push(stripShellWrapper(field.value));
    } else if (field?.kind === "reference") {
      sawReference = true;
    }
    searchFrom = objectLiteral.endIndex;
  }

  return { literals, sawReference };
}

/**
 * Extract shell cmds nested in Codex code-mode `exec` scripts.
 */
export function extractNestedExecCommandTexts(scriptText: string): string[] {
  if (!scriptText.trim()) {
    return [];
  }

  const fromCalls = extractFromExecCommandCalls(scriptText);
  const commands = [...fromCalls.literals];
  if (fromCalls.sawReference) {
    for (const command of collectReferencedCmdCandidates(scriptText)) {
      commands.push(command);
    }
  }
  return dedupePreserveOrder(commands);
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
