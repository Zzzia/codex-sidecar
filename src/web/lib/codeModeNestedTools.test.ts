import assert from "node:assert/strict";
import test from "node:test";
import {
  extractNestedToolCallNames,
  formatNestedToolName,
  summarizeNestedToolCalls,
} from "./codeModeNestedTools.js";
import { summarizeCodeModeExecScript } from "./commandSemantics.js";

test("formatNestedToolName rewrites mcp double-underscore names", () => {
  assert.equal(
    formatNestedToolName("mcp__ibrain__ibrain_get_run"),
    "ibrain/ibrain_get_run",
  );
  assert.equal(formatNestedToolName("lookup_order"), "lookup_order");
});

test("extractNestedToolCallNames reads MCP tools and skips specialized helpers", () => {
  const script = `const result = await tools.mcp__ibrain__ibrain_get_run({
  run_id: "run-dccb2bef4cf1462f983a0e23eddf99fe",
  wait_seconds: 60
});
if (result?.structuredContent) text(result.structuredContent);
else text(result);
await tools.exec_command({cmd:"pwd"});
await tools.apply_patch("*** Begin Patch\\n*** End Patch");
`;
  assert.deepEqual(extractNestedToolCallNames(script), [
    "mcp__ibrain__ibrain_get_run",
  ]);
});

test("summarizeNestedToolCalls joins multiple nested tools", () => {
  const script = `const results = await Promise.all([
  tools.mcp__playwright__browser_navigate({url:"https://example.com"}),
  tools.mcp__ibrain__ibrain_get_run({run_id:"run-1", wait_seconds:10})
]);
`;
  assert.equal(
    summarizeNestedToolCalls(script),
    "playwright/browser_navigate, ibrain/ibrain_get_run",
  );
});

test("summarizeCodeModeExecScript prefers shell, then MCP names", () => {
  const mcpOnly = `const result = await tools.mcp__ibrain__ibrain_get_run({run_id:"run-1",wait_seconds:60});
text(result);
`;
  assert.equal(summarizeCodeModeExecScript(mcpOnly), "ibrain/ibrain_get_run");

  const withShell = `await tools.mcp__ibrain__ibrain_get_run({run_id:"run-1"});
await tools.exec_command({cmd:"git status"});
`;
  assert.equal(summarizeCodeModeExecScript(withShell), "git status");
});
