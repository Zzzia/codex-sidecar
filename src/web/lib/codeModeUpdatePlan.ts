import {
  isCallMarkerAt,
  readBalancedJsObject,
  readJsStringLiteral,
  skipJsValue,
  skipJsWhitespaceAndComments,
} from "./codeModeJsScan";

export type NestedPlanStepStatus = "pending" | "in_progress" | "completed";

export interface NestedPlanStep {
  step: string;
  status: NestedPlanStepStatus;
}

export interface NestedUpdatePlan {
  explanation: string;
  items: NestedPlanStep[];
}

type PlanField =
  | { kind: "literal"; items: NestedPlanStep[] }
  | { kind: "reference"; name: string };

function normalizeStatus(value: string): NestedPlanStepStatus | null {
  if (value === "completed" || value === "in_progress" || value === "pending") {
    return value;
  }
  return null;
}

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

function extractPlanStepFromObject(objectText: string): NestedPlanStep | null {
  let index = 1;
  let step = "";
  let status: NestedPlanStepStatus | null = null;

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
      const identifier = readIdentifier(objectText, index);
      if (!identifier) {
        return null;
      }
      key = identifier.name;
      index = identifier.endIndex;
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

    if (key === "step") {
      const valueStart = objectText[index] ?? "";
      if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
        const literal = readJsStringLiteral(objectText, index);
        if (!literal) {
          return null;
        }
        step = literal.value.trim();
        index = literal.endIndex;
      } else {
        const nextIndex = skipJsValue(objectText, index);
        if (nextIndex === null) {
          return null;
        }
        index = nextIndex;
      }
    } else if (key === "status") {
      const valueStart = objectText[index] ?? "";
      if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
        const literal = readJsStringLiteral(objectText, index);
        if (!literal) {
          return null;
        }
        status = normalizeStatus(literal.value.trim());
        index = literal.endIndex;
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

  if (!step || !status) {
    return null;
  }
  return { step, status };
}

function parsePlanArrayLiteral(arrayText: string): NestedPlanStep[] {
  if (!arrayText.startsWith("[") || !arrayText.endsWith("]")) {
    return [];
  }

  const items: NestedPlanStep[] = [];
  let index = 1;
  while (index < arrayText.length - 1) {
    index = skipJsWhitespaceAndComments(arrayText, index);
    if (index >= arrayText.length - 1 || arrayText[index] === "]") {
      break;
    }

    if (arrayText[index] === "{") {
      const objectLiteral = readBalancedJsObject(arrayText, index);
      if (!objectLiteral) {
        break;
      }
      const step = extractPlanStepFromObject(objectLiteral.text);
      if (step) {
        items.push(step);
      }
      index = objectLiteral.endIndex;
    } else {
      const nextIndex = skipJsValue(arrayText, index);
      if (nextIndex === null) {
        break;
      }
      index = nextIndex;
    }

    index = skipJsWhitespaceAndComments(arrayText, index);
    if (arrayText[index] === ",") {
      index += 1;
    }
  }

  return items;
}

function extractUpdatePlanFields(objectText: string): {
  explanation: string;
  plan: PlanField | null;
} {
  let index = 1;
  let explanation = "";
  let plan: PlanField | null = null;

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
        break;
      }
      key = literal.value;
      index = literal.endIndex;
    } else if (/[A-Za-z_$]/.test(keyStart)) {
      const identifier = readIdentifier(objectText, index);
      if (!identifier) {
        break;
      }
      key = identifier.name;
      index = identifier.endIndex;
    } else {
      break;
    }

    index = skipJsWhitespaceAndComments(objectText, index);

    // ES object shorthand: { plan } or { explanation, plan }
    if (objectText[index] !== ":") {
      if (key === "plan" && (objectText[index] === "," || objectText[index] === "}")) {
        plan = { kind: "reference", name: "plan" };
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

    if (key === "explanation") {
      const valueStart = objectText[index] ?? "";
      if (valueStart === '"' || valueStart === "'" || valueStart === "`") {
        const literal = readJsStringLiteral(objectText, index);
        if (literal) {
          explanation = literal.value.trim();
          index = literal.endIndex;
        }
      } else {
        const nextIndex = skipJsValue(objectText, index);
        if (nextIndex === null) {
          break;
        }
        index = nextIndex;
      }
    } else if (key === "plan") {
      const valueStart = objectText[index] ?? "";
      if (valueStart === "[") {
        const endIndex = skipJsValue(objectText, index);
        if (endIndex === null) {
          break;
        }
        const items = parsePlanArrayLiteral(objectText.slice(index, endIndex));
        if (items.length > 0) {
          plan = { kind: "literal", items };
        }
        index = endIndex;
      } else if (/[A-Za-z_$]/.test(valueStart)) {
        const identifier = readIdentifier(objectText, index);
        if (!identifier) {
          break;
        }
        plan = { kind: "reference", name: identifier.name };
        index = identifier.endIndex;
      } else {
        const nextIndex = skipJsValue(objectText, index);
        if (nextIndex === null) {
          break;
        }
        index = nextIndex;
      }
    } else {
      const nextIndex = skipJsValue(objectText, index);
      if (nextIndex === null) {
        break;
      }
      index = nextIndex;
    }

    index = skipJsWhitespaceAndComments(objectText, index);
    if (objectText[index] === ",") {
      index += 1;
    }
  }

  return { explanation, plan };
}

function findAssignedArrayLiteral(
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
    if ((before && /[A-Za-z0-9_$]/.test(before)) || (after && /[A-Za-z0-9_$]/.test(after))) {
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
    if (scriptText[index] !== "[") {
      searchFrom = nameIndex + marker.length;
      continue;
    }

    const endIndex = skipJsValue(scriptText, index);
    if (endIndex === null) {
      searchFrom = nameIndex + marker.length;
      continue;
    }
    return scriptText.slice(index, endIndex);
  }

  return null;
}

function resolvePlanField(
  scriptText: string,
  plan: PlanField | null,
): NestedPlanStep[] {
  if (!plan) {
    return [];
  }
  if (plan.kind === "literal") {
    return plan.items;
  }

  const arrayLiteral = findAssignedArrayLiteral(scriptText, plan.name);
  if (!arrayLiteral) {
    return [];
  }
  return parsePlanArrayLiteral(arrayLiteral);
}

/**
 * Extract nested tools.update_plan({...}) payloads from code-mode exec scripts.
 * Supports inline plan arrays and nearby `const plan = [...]` references.
 */
export function extractNestedUpdatePlans(scriptText: string): NestedUpdatePlan[] {
  if (!scriptText.trim()) {
    return [];
  }

  const marker = "tools.update_plan";
  const plans: NestedUpdatePlan[] = [];
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

    let index = skipJsWhitespaceAndComments(
      scriptText,
      markerIndex + marker.length,
    );
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

    const fields = extractUpdatePlanFields(objectLiteral.text);
    const items = resolvePlanField(scriptText, fields.plan);
    if (items.length > 0) {
      plans.push({
        explanation: fields.explanation,
        items,
      });
    }
    searchFrom = objectLiteral.endIndex;
  }

  return plans;
}

/**
 * True when a code-mode exec script only updates progress and has no nested
 * shell / write_stdin / patch work that should appear in the timeline body.
 */
export function isUpdatePlanOnlyCodeModeScript(
  scriptText: string,
  hasNestedShellOrWriteWork: boolean,
): boolean {
  if (hasNestedShellOrWriteWork) {
    return false;
  }
  return extractNestedUpdatePlans(scriptText).length > 0;
}
