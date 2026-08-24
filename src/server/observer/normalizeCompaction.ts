import type { TimelineEvent } from "../../shared/types.js";

export function countReplacementHistoryItems(
  payload: Record<string, unknown>,
): number | undefined {
  return Array.isArray(payload.replacement_history)
    ? payload.replacement_history.length
    : undefined;
}

export function eventItemType(payload: Record<string, unknown>): string | undefined {
  if (!payload.item || typeof payload.item !== "object") {
    return undefined;
  }

  const itemType = (payload.item as Record<string, unknown>).type;
  return typeof itemType === "string" ? itemType : undefined;
}

export function describeCompactionDetail(
  state: "running" | "completed",
  replacementItemCount: number | undefined,
): string {
  if (state === "completed") {
    if (typeof replacementItemCount !== "number") {
      return "Codex has completed long-session context compaction";
    }

    return `Codex completed long-session context compaction, keeping ${replacementItemCount} history items`;
  }

  if (typeof replacementItemCount !== "number") {
    return "Codex is organizing long-session context";
  }

  return `Codex is organizing long-session context, keeping ${replacementItemCount} history items`;
}

const MIN_REPLACED_ASSISTANT_CHARS = 40;

export function compactionReplacesAssistant(
  assistantText: string | undefined,
  compactedMessage: string,
): boolean {
  if (!assistantText || !compactedMessage) {
    return false;
  }

  const assistant = assistantText.trim();
  const compacted = compactedMessage.trim();
  if (assistant.length < MIN_REPLACED_ASSISTANT_CHARS || !compacted) {
    return false;
  }

  return compacted.includes(assistant) || assistant.includes(compacted);
}

export function compactionEvent(options: {
  id: string;
  ts: string;
  state: "running" | "completed";
  title: string;
  detail: string;
  replacementItemCount?: number;
  replacedAssistantText?: string;
}): TimelineEvent {
  return {
    id: options.id,
    ts: options.ts,
    kind: "compaction",
    state: options.state,
    title: options.title,
    detail: options.detail,
    ...(typeof options.replacementItemCount === "number"
      ? { replacementItemCount: options.replacementItemCount }
      : {}),
    ...(options.replacedAssistantText
      ? { replacedAssistantText: options.replacedAssistantText }
      : {}),
  };
}
