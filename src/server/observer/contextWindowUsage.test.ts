import test from "node:test";
import assert from "node:assert/strict";
import {
  contextRemainingPercent,
  updateContextWindowUsage,
} from "./contextWindowUsage.js";

test("contextRemainingPercent matches Codex baseline window formula", () => {
  assert.equal(contextRemainingPercent(0, 258_400), 100);
  assert.equal(contextRemainingPercent(12_000, 258_400), 100);
  assert.equal(contextRemainingPercent(135_200, 258_400), 50);
  assert.equal(contextRemainingPercent(258_400, 258_400), 0);
});

test("updateContextWindowUsage reads task_started and token_count records", () => {
  const started = updateContextWindowUsage(
    {
      timestamp: "2026-05-06T08:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        model_context_window: 258_400,
      },
    },
    null,
  );

  assert.equal(started?.usedPercent, 0);
  assert.equal(started?.remainingPercent, 100);

  const updated = updateContextWindowUsage(
    {
      timestamp: "2026-05-06T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 150_000,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 150_000,
          },
          last_token_usage: {
            input_tokens: 135_200,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 135_200,
          },
          model_context_window: 258_400,
        },
      },
    },
    started,
  );

  assert.equal(updated?.usedPercent, 50);
  assert.equal(updated?.remainingPercent, 50);
  assert.equal(updated?.currentTokens, 135_200);
  assert.equal(updated?.contextWindow, 258_400);
});

test("updateContextWindowUsage preserves previous window when token_count omits it", () => {
  const updated = updateContextWindowUsage(
    {
      timestamp: "2026-05-06T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            total_tokens: 135_200,
          },
        },
      },
    },
    {
      usedPercent: 0,
      remainingPercent: 100,
      currentTokens: 0,
      contextWindow: 258_400,
      updatedAt: "2026-05-06T08:00:00.000Z",
    },
  );

  assert.equal(updated?.usedPercent, 50);
  assert.equal(updated?.contextWindow, 258_400);
});
