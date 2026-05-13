import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyMermaidChart,
  prepareMermaidChartForRender,
} from "./MermaidBlock.js";

test("prepareMermaidChartForRender quotes flowchart labels with route params", () => {
  const chart = `flowchart TD
  F --> B[BFF /conversations/{id}/turn]
  B --> D[GUI-Agent 判断本轮效果]`;

  const repaired = prepareMermaidChartForRender(chart);

  assert.match(repaired, /B\["BFF \/conversations\/\{id\}\/turn"\]/);
  assert.match(repaired, /D\[GUI-Agent 判断本轮效果\]/);
});

test("prepareMermaidChartForRender keeps quoted labels and special shapes intact", () => {
  const chart = `flowchart TD
  A["BFF /conversations/{id}/turn"] --> B[(DB {table})]
  B --> C[普通节点]`;

  assert.equal(prepareMermaidChartForRender(chart), chart);
});

test("isLikelyMermaidChart accepts full diagrams but rejects isolated snippets", () => {
  assert.equal(
    isLikelyMermaidChart(`flowchart TD
  A --> B`),
    true,
  );
  assert.equal(isLikelyMermaidChart("B[BFF /conversations/{id}/turn]"), false);
});
