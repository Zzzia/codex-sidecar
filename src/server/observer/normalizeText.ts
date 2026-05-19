const THREAD_SUMMARY_TEXT_LIMIT = 100;
const MEMORY_CITATION_OPEN = "<oai-mem-citation>";
const MEMORY_CITATION_CLOSE = "</oai-mem-citation>";
const PROPOSED_PLAN_OPEN = "<proposed_plan>";
const PROPOSED_PLAN_CLOSE = "</proposed_plan>";

type AssistantTextSegment = {
  kind: "message" | "plan";
  text: string;
};

export function summarizeThreadText(
  value: string,
  limit = THREAD_SUMMARY_TEXT_LIMIT,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const chars = Array.from(normalized);
  if (chars.length <= limit) {
    return normalized;
  }

  return `${chars.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

export function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const part = entry as Record<string, unknown>;
      const text = part.text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("");
}

export function stripMemoryCitationBlocks(text: string): string {
  let visibleText = "";
  let cursor = 0;

  while (cursor < text.length) {
    const openIndex = text.indexOf(MEMORY_CITATION_OPEN, cursor);
    if (openIndex === -1) {
      visibleText += text.slice(cursor);
      break;
    }

    visibleText += text.slice(cursor, openIndex);

    const bodyStart = openIndex + MEMORY_CITATION_OPEN.length;
    const closeIndex = text.indexOf(MEMORY_CITATION_CLOSE, bodyStart);
    if (closeIndex === -1) {
      break;
    }

    cursor = closeIndex + MEMORY_CITATION_CLOSE.length;
  }

  return visibleText;
}

function splitPreservingLineEndings(text: string): string[] {
  return text.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

export function splitProposedPlanBlocks(text: string): AssistantTextSegment[] {
  const segments: AssistantTextSegment[] = [];
  let currentKind: AssistantTextSegment["kind"] = "message";
  let currentText = "";

  const pushCurrent = () => {
    if (!currentText.trim()) {
      currentText = "";
      return;
    }
    segments.push({ kind: currentKind, text: currentText });
    currentText = "";
  };

  for (const line of splitPreservingLineEndings(text)) {
    const normalizedLine = line.replace(/\r?\n$/, "").trim();
    if (currentKind === "message" && normalizedLine === PROPOSED_PLAN_OPEN) {
      pushCurrent();
      currentKind = "plan";
      continue;
    }

    if (currentKind === "plan" && normalizedLine === PROPOSED_PLAN_CLOSE) {
      pushCurrent();
      currentKind = "message";
      continue;
    }

    currentText += line;
  }

  pushCurrent();
  return segments;
}

export function getMessageRole(role: unknown): "assistant" | "user" | "system" {
  if (role === "assistant" || role === "user") {
    return role;
  }
  return "system";
}
