export interface TimelineScrollAnchor {
  cardId: string;
  cardIndex: number;
  offsetTop: number;
  atBottom: boolean;
}

const VIEWPORT_EDGE_PADDING = 8;
const BOTTOM_DISTANCE_THRESHOLD = 8;

function listTurnCards(scroller: HTMLElement): HTMLElement[] {
  return Array.from(scroller.querySelectorAll<HTMLElement>(".turn-card"));
}

function findTurnCardById(
  scroller: HTMLElement,
  cardId: string,
): HTMLElement | null {
  for (const card of listTurnCards(scroller)) {
    if (card.dataset.cardId === cardId) {
      return card;
    }
  }
  return null;
}

function findCurrentTurnCard(scroller: HTMLElement): HTMLElement | null {
  const cards = listTurnCards(scroller);
  if (cards.length === 0) {
    return null;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const viewportTop = scrollerRect.top + VIEWPORT_EDGE_PADDING;
  const viewportBottom = scrollerRect.bottom - VIEWPORT_EDGE_PADDING;

  let crossingTop: HTMLElement | null = null;
  let crossingTopOffset = Number.NEGATIVE_INFINITY;
  let firstVisibleBelow: HTMLElement | null = null;
  let firstVisibleBelowOffset = Number.POSITIVE_INFINITY;

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= viewportTop || rect.top >= viewportBottom) {
      continue;
    }

    const offset = rect.top - scrollerRect.top;
    if (rect.top <= viewportTop && offset > crossingTopOffset) {
      crossingTop = card;
      crossingTopOffset = offset;
      continue;
    }

    if (offset < firstVisibleBelowOffset) {
      firstVisibleBelow = card;
      firstVisibleBelowOffset = offset;
    }
  }

  return crossingTop ?? firstVisibleBelow ?? cards[0] ?? null;
}

export function findCurrentTurnCardIndex(scroller: HTMLElement): number | null {
  const card = findCurrentTurnCard(scroller);
  if (!card) {
    return null;
  }

  const value = Number(card.dataset.cardIndex ?? "");
  return Number.isInteger(value) ? value : null;
}

export function readTimelineScrollAnchor(
  scroller: HTMLElement,
): TimelineScrollAnchor | null {
  const card = findCurrentTurnCard(scroller);
  const cardId = card?.dataset.cardId;
  const cardIndex = Number(card?.dataset.cardIndex ?? "");
  if (!card || !cardId || !Number.isInteger(cardIndex)) {
    return null;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const distanceToBottom =
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;

  return {
    cardId,
    cardIndex,
    offsetTop: cardRect.top - scrollerRect.top,
    atBottom: distanceToBottom <= BOTTOM_DISTANCE_THRESHOLD,
  };
}

export function restoreTimelineScrollAnchor(
  scroller: HTMLElement,
  anchor: TimelineScrollAnchor,
): boolean {
  const card = findTurnCardById(scroller, anchor.cardId);
  if (!card) {
    return false;
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const offsetDelta = cardRect.top - scrollerRect.top - anchor.offsetTop;
  if (Math.abs(offsetDelta) <= 0.5) {
    return true;
  }

  scroller.scrollTop += offsetDelta;
  return true;
}
