import {
  isCallMarkerAt,
  readBalancedJsObject,
  readJsStringLiteral,
  skipJsValue,
  skipJsWhitespaceAndComments,
} from "./codeModeJsScan";

export type NestedWriteStdinAction = {
  sessionId: string | null;
  chars: string | null;
};

function extractWriteStdinFields(objectText: string): NestedWriteStdinAction | null {
  let index = 1;
  let sessionId: string | null = null;
  let chars: string | null = null;
  let sawSessionKey = false;
  let sawCharsKey = false;

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
      if (objectText[index] === ",") {
        index += 1;
        continue;
      }
      break;
    }
    index += 1;
    index = skipJsWhitespaceAndComments(objectText, index);

    if (key === "session_id") {
      sawSessionKey = true;
      const valueStart = objectText[index] ?? "";
      if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
        const literal = readJsStringLiteral(objectText, index);
        if (literal) {
          sessionId = literal.value.trim() || null;
          index = literal.endIndex;
        }
      } else if (/\d/.test(valueStart)) {
        let end = index;
        while (end < objectText.length && /[0-9]/.test(objectText[end] ?? "")) {
          end += 1;
        }
        sessionId = objectText.slice(index, end);
        index = end;
      } else {
        const nextIndex = skipJsValue(objectText, index);
        if (nextIndex === null) {
          return null;
        }
        index = nextIndex;
      }
    } else if (key === "chars") {
      sawCharsKey = true;
      const valueStart = objectText[index] ?? "";
      if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
        const literal = readJsStringLiteral(objectText, index);
        if (literal) {
          chars = literal.value;
          index = literal.endIndex;
        }
      } else {
        const nextIndex = skipJsValue(objectText, index);
        if (nextIndex === null) {
          return null;
        }
        index = nextIndex;
      }
    } else {
      const nextIndex = skipJsValue(objectText, index);
      if (nextIndex === null) {
        return null;
      }
      index = nextIndex;
    }

    index = skipJsWhitespaceAndComments(objectText, index);
    if (objectText[index] === ",") {
      index += 1;
    }
  }

  if (!sawSessionKey && !sawCharsKey) {
    return null;
  }
  return { sessionId, chars };
}

/**
 * Extract nested tools.write_stdin({...}) interactions from code-mode scripts.
 */
export function extractNestedWriteStdinActions(
  scriptText: string,
): NestedWriteStdinAction[] {
  const marker = "tools.write_stdin";
  const actions: NestedWriteStdinAction[] = [];
  let searchFrom = 0;

  while (searchFrom < scriptText.length) {
    const markerIndex = scriptText.indexOf(marker, searchFrom);
    if (markerIndex === -1) {
      break;
    }
    if (!isCallMarkerAt(scriptText, markerIndex, marker)) {
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

    const fields = extractWriteStdinFields(objectLiteral.text);
    if (fields) {
      actions.push(fields);
    }
    searchFrom = objectLiteral.endIndex;
  }

  return actions;
}

export function formatWriteStdinChars(chars: string | null): string {
  if (chars === null) {
    return "input";
  }
  if (chars.length === 0) {
    return "poll";
  }
  if (chars === "\u0003") {
    return "Ctrl-C";
  }
  if (chars === "\u0004") {
    return "Ctrl-D";
  }
  if (chars === "\n" || chars === "\r" || chars === "\r\n") {
    return "Enter";
  }
  if (chars.length === 1 && chars.charCodeAt(0) < 32) {
    return `Ctrl-${String.fromCharCode(64 + chars.charCodeAt(0))}`;
  }

  const printable = chars.replace(/\r\n/g, "\\n").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  if (printable.length <= 40) {
    return JSON.stringify(printable);
  }
  return `${JSON.stringify(printable.slice(0, 37))}…`;
}

export function writeStdinActionsPreview(actions: NestedWriteStdinAction[]): string {
  if (actions.length === 0) {
    return "";
  }

  const labels = actions.map((action) => {
    const input = formatWriteStdinChars(action.chars);
    if (action.sessionId) {
      return `${input} · session ${action.sessionId}`;
    }
    return input;
  });

  if (labels.length === 1) {
    return labels[0] ?? "";
  }

  const inputs = new Set(actions.map((action) => formatWriteStdinChars(action.chars)));
  const sessionIds = actions
    .map((action) => action.sessionId)
    .filter((value): value is string => Boolean(value));
  if (inputs.size === 1 && sessionIds.length === actions.length) {
    const input = [...inputs][0] ?? "input";
    return `${input} · sessions ${sessionIds.join(", ")}`;
  }

  return labels.join(" · ");
}
