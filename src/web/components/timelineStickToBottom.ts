/** Distance (px) within which the viewport counts as "at bottom". */
export const BOTTOM_DISTANCE_THRESHOLD = 8;

/** Ignore sub-pixel scrollTop noise when detecting upward user scrolls. */
export const SCROLL_TOP_DECREASE_EPSILON = 1;

export type StickToBottomIntent =
  | "enter_by_jump"
  | "enter_by_arrive"
  | "leave_by_user"
  | "leave_by_jump_top"
  | "reset_thread";

/**
 * Single owner for stick-to-bottom intent transitions.
 * Content growth / layout resize never leave stick; only user intent does.
 */
export function nextStickToBottom(
  _current: boolean,
  intent: StickToBottomIntent,
): boolean {
  switch (intent) {
    case "enter_by_jump":
    case "enter_by_arrive":
    case "reset_thread":
      return true;
    case "leave_by_user":
    case "leave_by_jump_top":
      return false;
  }
}

export function distanceToBottom(
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number,
): number {
  return scrollHeight - clientHeight - scrollTop;
}

export function isNearBottom(
  distance: number,
  threshold: number = BOTTOM_DISTANCE_THRESHOLD,
): boolean {
  return distance <= threshold;
}

export function isScrollTopDecreased(
  previousScrollTop: number,
  scrollTop: number,
  epsilon: number = SCROLL_TOP_DECREASE_EPSILON,
): boolean {
  return scrollTop < previousScrollTop - epsilon;
}

export interface StickScrollDecision {
  stick: boolean;
  /** Still mid programmatic scroll-to-bottom. */
  programmatic: boolean;
}

/**
 * Resolve stick after a scroll position sample.
 *
 * Canonical rules:
 * 1. at bottom → stick on
 * 2. programmatic and not at bottom → keep stick (en route)
 * 3. user intent (explicit or scrollTop decreased) and not at bottom → stick off
 * 4. content/layout drift off bottom without user intent → keep stick
 */
export function stickAfterScroll(options: {
  stick: boolean;
  atBottom: boolean;
  programmatic: boolean;
  userIntent: boolean;
}): StickScrollDecision {
  if (options.atBottom) {
    return {
      stick: true,
      programmatic: false,
    };
  }

  if (options.programmatic) {
    return {
      stick: options.stick,
      programmatic: true,
    };
  }

  if (options.userIntent) {
    return {
      stick: false,
      programmatic: false,
    };
  }

  return {
    stick: options.stick,
    programmatic: false,
  };
}
