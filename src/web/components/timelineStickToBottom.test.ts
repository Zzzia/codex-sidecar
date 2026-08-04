import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOTTOM_DISTANCE_THRESHOLD,
  distanceToBottom,
  isNearBottom,
  isScrollTopDecreased,
  nextStickToBottom,
  stickAfterScroll,
} from "./timelineStickToBottom.js";

test("isNearBottom uses the shared threshold", () => {
  assert.equal(isNearBottom(BOTTOM_DISTANCE_THRESHOLD), true);
  assert.equal(isNearBottom(BOTTOM_DISTANCE_THRESHOLD + 1), false);
  assert.equal(distanceToBottom(1000, 400, 592), 8);
  assert.equal(isNearBottom(distanceToBottom(1000, 400, 592)), true);
});

test("nextStickToBottom only enters or leaves by intent", () => {
  assert.equal(nextStickToBottom(false, "enter_by_jump"), true);
  assert.equal(nextStickToBottom(false, "enter_by_arrive"), true);
  assert.equal(nextStickToBottom(false, "reset_thread"), true);
  assert.equal(nextStickToBottom(true, "leave_by_user"), false);
  assert.equal(nextStickToBottom(true, "leave_by_jump_top"), false);
});

test("programmatic scroll keeps stick while en route to bottom", () => {
  assert.deepEqual(
    stickAfterScroll({
      stick: true,
      atBottom: false,
      programmatic: true,
      userIntent: false,
    }),
    { stick: true, programmatic: true },
  );
  assert.deepEqual(
    stickAfterScroll({
      stick: true,
      atBottom: true,
      programmatic: true,
      userIntent: false,
    }),
    { stick: true, programmatic: false },
  );
});

test("user intent leaves stick only when off bottom", () => {
  assert.deepEqual(
    stickAfterScroll({
      stick: true,
      atBottom: false,
      programmatic: false,
      userIntent: true,
    }),
    { stick: false, programmatic: false },
  );
  assert.deepEqual(
    stickAfterScroll({
      stick: false,
      atBottom: true,
      programmatic: false,
      userIntent: true,
    }),
    { stick: true, programmatic: false },
  );
});

test("content growth off-bottom without user intent keeps stick", () => {
  assert.deepEqual(
    stickAfterScroll({
      stick: true,
      atBottom: false,
      programmatic: false,
      userIntent: false,
    }),
    { stick: true, programmatic: false },
  );
});

test("scrollTop decrease detects upward user scroll", () => {
  assert.equal(isScrollTopDecreased(400, 350), true);
  assert.equal(isScrollTopDecreased(400, 400), false);
  assert.equal(isScrollTopDecreased(400, 420), false);
  assert.equal(isScrollTopDecreased(400, 399.5), false);
});
