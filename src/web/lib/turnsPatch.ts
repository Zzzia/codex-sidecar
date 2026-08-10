import type { PatchChange } from "@shared/types";
import {
  extractNestedApplyPatches,
  hasNestedApplyPatchCall,
  patchChangesFromInvocation,
  patchFilePathsFromInvocation,
  summarizePatchInvocation,
} from "./codeModeApplyPatch";
import type { PatchRunView, TurnBlock } from "./turnTypes";

/** Minimal turn surface needed to register and settle patch runs. */
export interface TurnPatchHost {
  updatedAt: string;
  blocks: TurnBlock[];
  patchMap: Map<string, PatchRunView>;
  pendingPatchCallIds: string[];
}

function ensurePatchBlock(turn: TurnPatchHost): PatchRunView[] {
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === "patch_runs") {
    return last.items;
  }

  const block: TurnBlock = {
    type: "patch_runs",
    id: `patches:${turn.blocks.length}`,
    items: [],
  };
  turn.blocks.push(block);
  return block.items;
}

export function ensurePatchRun(
  turn: TurnPatchHost,
  callId: string,
  fallback: Partial<PatchRunView>,
): PatchRunView {
  const existing = turn.patchMap.get(callId);
  if (existing) {
    if (fallback.invocationText && !existing.invocationText) {
      existing.invocationText = fallback.invocationText;
    }
    if (fallback.summary && existing.summary === "Code changes") {
      existing.summary = fallback.summary;
    }
    if (fallback.changes && fallback.changes.length > 0 && existing.changes.length === 0) {
      existing.changes = fallback.changes;
    }
    if (typeof fallback.success === "boolean") {
      existing.success = fallback.success;
    }
    if (fallback.ts && !existing.ts) {
      existing.ts = fallback.ts;
    }
    return existing;
  }

  const next: PatchRunView = {
    callId,
    id: callId || `${fallback.ts ?? turn.updatedAt}:patch`,
    ts: fallback.ts ?? turn.updatedAt,
    invocationText: fallback.invocationText ?? "",
    summary: fallback.summary ?? "Code changes",
    success: fallback.success ?? true,
    changes: fallback.changes ?? [],
  };

  ensurePatchBlock(turn).push(next);
  turn.patchMap.set(callId, next);
  return next;
}

function changePathSet(changes: PatchChange[]): Set<string> {
  return new Set(changes.map((change) => change.path));
}

function pathSetsOverlap(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) {
    return false;
  }
  for (const path of left) {
    if (right.has(path)) {
      return true;
    }
  }
  return false;
}

function findPendingPatchRun(
  turn: TurnPatchHost,
  endChanges: PatchChange[],
): PatchRunView | null {
  if (turn.pendingPatchCallIds.length === 0) {
    return null;
  }

  const endPaths = changePathSet(endChanges);
  let fallback: PatchRunView | null = null;

  for (const pendingId of turn.pendingPatchCallIds) {
    const patch = turn.patchMap.get(pendingId);
    if (!patch) {
      continue;
    }
    if (!fallback) {
      fallback = patch;
    }
    if (endPaths.size === 0) {
      return patch;
    }
    const provisionalPaths = new Set(patchFilePathsFromInvocation(patch.invocationText));
    if (provisionalPaths.size === 0 || pathSetsOverlap(provisionalPaths, endPaths)) {
      return patch;
    }
  }

  // Order-stable fallback when paths cannot be matched (template placeholders, etc.).
  return fallback;
}

export function settlePatchRun(
  turn: TurnPatchHost,
  callId: string,
  payload: {
    ts: string;
    summary: string;
    success: boolean;
    changes: PatchChange[];
  },
): PatchRunView {
  const existingById = turn.patchMap.get(callId);
  const pending = existingById ? null : findPendingPatchRun(turn, payload.changes);
  const patch =
    existingById ??
    pending ??
    ensurePatchRun(turn, callId, {
      ts: payload.ts,
      summary: payload.summary,
      success: payload.success,
      changes: payload.changes,
    });

  // Structured apply results always win over Begin Patch previews.
  patch.summary = payload.summary;
  patch.success = payload.success;
  patch.changes = payload.changes;
  if (payload.ts) {
    patch.ts = payload.ts;
  }

  if (pending && pending.callId !== callId) {
    turn.patchMap.set(callId, pending);
  }

  const settledIds = new Set(
    [patch.callId, callId, pending?.callId].filter(Boolean) as string[],
  );
  turn.pendingPatchCallIds = turn.pendingPatchCallIds.filter((id) => !settledIds.has(id));

  return patch;
}

export function registerCodeModeApplyPatches(
  turn: TurnPatchHost,
  outerCallId: string,
  ts: string,
  script: string,
): number {
  const nested = extractNestedApplyPatches(script);
  if (nested.length === 0) {
    if (hasNestedApplyPatchCall(script)) {
      // Call present but args unresolved (e.g. template with runtime values).
      // Reserve a provisional slot so patch_apply_end can still merge in-order.
      const callId = `${outerCallId}:patch:0`;
      ensurePatchRun(turn, callId, {
        ts,
        summary: "Code changes",
        changes: [],
      });
      if (!turn.pendingPatchCallIds.includes(callId)) {
        turn.pendingPatchCallIds.push(callId);
      }
      return 1;
    }
    return 0;
  }

  for (const [index, entry] of nested.entries()) {
    const callId = `${outerCallId}:patch:${index}`;
    const changes = patchChangesFromInvocation(entry.patchText);
    ensurePatchRun(turn, callId, {
      ts,
      invocationText: entry.patchText,
      summary: summarizePatchInvocation(entry.patchText),
      changes,
    });
    // Always queue for end-event merge so structured apply results replace
    // best-effort invocation previews when they arrive.
    if (!turn.pendingPatchCallIds.includes(callId)) {
      turn.pendingPatchCallIds.push(callId);
    }
  }
  return nested.length;
}

export function registerDirectApplyPatch(
  turn: TurnPatchHost,
  callId: string,
  ts: string,
  patchText: string,
): void {
  const changes = patchChangesFromInvocation(patchText);
  ensurePatchRun(turn, callId, {
    ts,
    invocationText: patchText,
    summary: summarizePatchInvocation(patchText),
    changes,
  });
  if (!turn.pendingPatchCallIds.includes(callId)) {
    turn.pendingPatchCallIds.push(callId);
  }
}
