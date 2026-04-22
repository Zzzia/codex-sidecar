import type { ThreadStatus, TimelineEvent } from "@shared/types";

export type ProgressStepStatus = "pending" | "in_progress" | "completed";

export interface ProgressStepView {
  step: string;
  status: ProgressStepStatus;
}

export interface ThreadProgressView {
  ts: string;
  explanation: string;
  items: ProgressStepView[];
  source: "update_plan" | "assistant_plan";
}

type ToolCallEvent = Extract<TimelineEvent, { kind: "tool_call" }>;
type MessageEvent = Extract<TimelineEvent, { kind: "message" }>;

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

function extractPlanText(text: string): string | null {
  const match = text.match(/<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/);
  return match?.[1]?.trim() ?? null;
}

function normalizeStatus(value: unknown): ProgressStepStatus | null {
  if (value === "completed" || value === "in_progress" || value === "pending") {
    return value;
  }
  return null;
}

function parsePlanItems(value: unknown): ProgressStepView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const step = typeof record.step === "string" ? record.step.trim() : "";
      const status = normalizeStatus(record.status);
      if (!step || !status) {
        return null;
      }

      return {
        step,
        status,
      };
    })
    .filter((entry): entry is ProgressStepView => Boolean(entry));
}

function parseUpdatePlanEvent(event: ToolCallEvent): ThreadProgressView | null {
  if (event.tool.name !== "update_plan") {
    return null;
  }

  const parsed = tryParseJson(event.tool.argumentsText);
  const items = parsePlanItems(parsed?.plan);
  if (items.length === 0) {
    return null;
  }

  return {
    ts: event.ts,
    explanation:
      typeof parsed?.explanation === "string" ? parsed.explanation.trim() : "",
    items,
    source: "update_plan",
  };
}

function parseAssistantPlanEvent(
  event: MessageEvent,
): ThreadProgressView | null {
  if (event.role !== "assistant" || !event.isPlan) {
    return null;
  }

  const text = extractPlanText(event.text) ?? event.text;
  const lines = text
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const items: ProgressStepView[] = [];
  const explanationLines: string[] = [];

  for (const line of lines) {
    const listMatch = line.match(/^([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      items.push({
        step: listMatch[2]?.trim() ?? "",
        status: "pending",
      });
      continue;
    }

    if (!line.startsWith("#")) {
      explanationLines.push(line);
    }
  }

  if (items.length === 0) {
    return null;
  }

  return {
    ts: event.ts,
    explanation: explanationLines.join(" ").trim(),
    items,
    source: "assistant_plan",
  };
}

function findLatestStatusEvent(
  events: TimelineEvent[],
): Extract<TimelineEvent, { kind: "status" }> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "status") {
      return event;
    }
  }

  return null;
}

function finalizeProgressState(
  progress: ThreadProgressView | null,
  finalStatus: ThreadStatus,
  finalTs: string,
): ThreadProgressView | null {
  if (!progress) {
    return null;
  }

  if (finalStatus !== "completed") {
    return progress;
  }

  if (!progress.items.some((item) => item.status === "in_progress")) {
    return progress;
  }

  return {
    ...progress,
    ts: finalTs || progress.ts,
    items: progress.items.map((item) =>
      item.status === "in_progress"
        ? { ...item, status: "completed" }
        : item,
    ),
  };
}

export function extractThreadProgress(
  events: TimelineEvent[],
  threadStatus: ThreadStatus = "idle",
): ThreadProgressView | null {
  let assistantFallback: ThreadProgressView | null = null;
  let latestPlan: ThreadProgressView | null = null;

  for (const event of events) {
    if (event.kind === "tool_call") {
      const parsed = parseUpdatePlanEvent(event);
      if (parsed) {
        latestPlan = parsed;
      }
      continue;
    }

    if (event.kind === "message" && event.role === "assistant" && event.isPlan) {
      const parsed = parseAssistantPlanEvent(event);
      if (parsed) {
        assistantFallback = parsed;
      }
    }
  }

  const latestStatusEvent = findLatestStatusEvent(events);
  const finalStatus =
    threadStatus !== "idle"
      ? threadStatus
      : latestStatusEvent?.status ?? "idle";
  const finalTs = latestStatusEvent?.ts ?? latestPlan?.ts ?? assistantFallback?.ts ?? "";

  return finalizeProgressState(latestPlan ?? assistantFallback, finalStatus, finalTs);
}
