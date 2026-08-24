import type { TimelineEvent } from "@shared/types";
import type { CompactionRunView, TurnBlock } from "./turnTypes";

interface CompactionTurn {
  blocks: TurnBlock[];
}

function ensureCompactionBlock(turn: CompactionTurn): CompactionRunView[] {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "compaction_runs") {
    return last.items;
  }

  const block: TurnBlock = {
    type: "compaction_runs",
    id: `compactions:${turn.blocks.length}`,
    items: [],
  };
  turn.blocks.push(block);
  return block.items;
}

function dropReplacedAssistantMarkdown(
  turn: CompactionTurn,
  replacedText: string,
): void {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type !== "assistant_markdown") {
    return;
  }

  const blockText = last.text.trim();
  const replaced = replacedText.trim();
  if (!replaced) {
    return;
  }

  if (blockText === replaced) {
    turn.blocks.pop();
    return;
  }

  if (blockText.endsWith(replaced)) {
    const remaining = blockText.slice(0, -replaced.length).trim();
    if (remaining) {
      last.text = remaining;
      return;
    }
    turn.blocks.pop();
  }
}

function applyCompactionEventToRun(
  item: CompactionRunView,
  event: Extract<TimelineEvent, { kind: "compaction" }>,
): void {
  item.state = event.state;
  item.title = event.title;
  if (event.state === "completed") {
    item.completedAt = event.ts;
  }
  if (typeof event.replacementItemCount === "number") {
    item.replacementItemCount = event.replacementItemCount;
    if (event.detail) {
      item.detail = event.detail;
    }
    return;
  }
  if (event.detail && !item.detail) {
    item.detail = event.detail;
  }
}

export function appendCompactionRun(
  turn: CompactionTurn,
  event: Extract<TimelineEvent, { kind: "compaction" }>,
): void {
  if (event.replacedAssistantText) {
    dropReplacedAssistantMarkdown(turn, event.replacedAssistantText);
  }

  const items = ensureCompactionBlock(turn);
  const last = items[items.length - 1];
  if (event.state === "completed") {
    let pending: CompactionRunView | null = null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item && item.state !== "completed") {
        pending = item;
        break;
      }
    }
    if (!pending && last?.state === "completed") {
      pending = last;
    }
    if (pending) {
      applyCompactionEventToRun(pending, event);
      return;
    }
  } else if (last?.state === "running") {
    applyCompactionEventToRun(last, event);
    return;
  }

  items.push({
    id: event.id,
    ts: event.ts,
    state: event.state,
    title: event.title,
    detail: event.detail ?? "",
    ...(typeof event.replacementItemCount === "number"
      ? { replacementItemCount: event.replacementItemCount }
      : {}),
    ...(event.state === "completed" ? { completedAt: event.ts } : {}),
  });
}
