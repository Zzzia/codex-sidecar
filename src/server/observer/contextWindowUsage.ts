import type { ContextWindowUsage } from "../../shared/types.js";

type JsonRecord = Record<string, unknown>;

const BASELINE_TOKENS = 12000;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function readNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function contextRemainingPercent(
  currentTokens: number,
  contextWindow: number,
): number {
  if (contextWindow <= BASELINE_TOKENS) {
    return 0;
  }

  const effectiveWindow = contextWindow - BASELINE_TOKENS;
  const used = Math.max(currentTokens - BASELINE_TOKENS, 0);
  const remaining = Math.max(effectiveWindow - used, 0);
  return clampPercent(Math.round((remaining / effectiveWindow) * 100));
}

function createContextUsage(
  currentTokens: number,
  contextWindow: number,
  updatedAt: string,
): ContextWindowUsage {
  const remainingPercent = contextRemainingPercent(currentTokens, contextWindow);
  return {
    usedPercent: clampPercent(100 - remainingPercent),
    remainingPercent,
    currentTokens: Math.max(0, Math.round(currentTokens)),
    contextWindow: Math.max(0, Math.round(contextWindow)),
    updatedAt,
  };
}

export function updateContextWindowUsage(
  raw: unknown,
  previous: ContextWindowUsage | null,
): ContextWindowUsage | null {
  const record = asRecord(raw);
  if (!record || readString(record, "type") !== "event_msg") {
    return previous;
  }

  const payload = asRecord(record.payload);
  if (!payload) {
    return previous;
  }

  const timestamp = readString(record, "timestamp") ?? previous?.updatedAt ?? "";
  const eventType = readString(payload, "type");
  if (eventType === "task_started" || eventType === "turn_started") {
    const contextWindow = readNumber(payload, "model_context_window");
    return contextWindow == null
      ? previous
      : createContextUsage(0, contextWindow, timestamp);
  }

  if (eventType !== "token_count") {
    return previous;
  }

  const info = asRecord(payload.info);
  const lastUsage = info ? asRecord(info.last_token_usage) : null;
  const currentTokens = lastUsage ? readNumber(lastUsage, "total_tokens") : null;
  const contextWindow =
    (info ? readNumber(info, "model_context_window") : null) ??
    previous?.contextWindow ??
    null;

  if (currentTokens == null || contextWindow == null) {
    return previous;
  }

  return createContextUsage(currentTokens, contextWindow, timestamp);
}
