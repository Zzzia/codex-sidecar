import type { ThreadStatus, TimelineEvent } from "@shared/types";
import { extractNestedUpdatePlans } from "./codeModeUpdatePlan";

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

function progressFromPlanPayload(options: {
  ts: string;
  explanation: string;
  items: ProgressStepView[];
}): ThreadProgressView | null {
  if (options.items.length === 0) {
    return null;
  }

  return {
    ts: options.ts,
    explanation: options.explanation,
    items: options.items,
    source: "update_plan",
  };
}

function parseClassicUpdatePlanEvent(
  event: ToolCallEvent,
): ThreadProgressView | null {
  if (event.tool.name !== "update_plan") {
    return null;
  }

  const parsed = tryParseJson(event.tool.argumentsText);
  return progressFromPlanPayload({
    ts: event.ts,
    explanation:
      typeof parsed?.explanation === "string" ? parsed.explanation.trim() : "",
    items: parsePlanItems(parsed?.plan),
  });
}

function parseCodeModeUpdatePlanEvent(
  event: ToolCallEvent,
): ThreadProgressView | null {
  // Only freeform code-mode `exec` scripts nest tools.update_plan(...).
  if (event.tool.name !== "exec") {
    return null;
  }

  const nested = extractNestedUpdatePlans(event.tool.argumentsText);
  if (nested.length === 0) {
    return null;
  }

  // One script may update the plan more than once; keep the last snapshot.
  const latest = nested[nested.length - 1];
  if (!latest) {
    return null;
  }

  return progressFromPlanPayload({
    ts: event.ts,
    explanation: latest.explanation,
    items: latest.items,
  });
}

function parseUpdatePlanEvent(event: ToolCallEvent): ThreadProgressView | null {
  return (
    parseClassicUpdatePlanEvent(event) ?? parseCodeModeUpdatePlanEvent(event)
  );
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
