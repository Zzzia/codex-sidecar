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
  source: "update_plan";
}

type ToolCallEvent = Extract<TimelineEvent, { kind: "tool_call" }>;

function sliceCurrentTurnEvents(events: TimelineEvent[]): TimelineEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "message" && event.role === "user") {
      return events.slice(index);
    }
  }

  return events;
}

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
  const currentTurnEvents = sliceCurrentTurnEvents(events);
  let latestPlan: ThreadProgressView | null = null;

  for (const event of currentTurnEvents) {
    if (event.kind === "tool_call") {
      const parsed = parseUpdatePlanEvent(event);
      if (parsed) {
        latestPlan = parsed;
      }
      continue;
    }
  }

  const latestStatusEvent = findLatestStatusEvent(currentTurnEvents);
  const finalStatus =
    threadStatus !== "idle"
      ? threadStatus
      : latestStatusEvent?.status ?? "idle";
  const finalTs = latestStatusEvent?.ts ?? latestPlan?.ts ?? "";

  return finalizeProgressState(latestPlan, finalStatus, finalTs);
}
