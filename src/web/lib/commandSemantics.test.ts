import test from "node:test";
import assert from "node:assert/strict";
import {
  extractExecCommandText,
  extractNestedExecCommandTexts,
  extractShellCommandTexts,
  parseExecCommand,
  shellCommandTextFromInvocation,
} from "./commandSemantics.js";

test("parseExecCommand keeps search intent when piping into formatting helpers", () => {
  const commands = parseExecCommand('rg -n "buildTurnCards" src/web/lib | head -n 5');

  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.type, "search");
  if (commands[0]?.type !== "search") {
    assert.fail("expected search command");
  }
  assert.equal(commands[0].query, "buildTurnCards");
  assert.equal(commands[0].path, "lib");
});

test("parseExecCommand extracts search and read sequence from chained commands", () => {
  const commands = parseExecCommand(
    'rg -n "ToolRunView" src/web/lib && sed -n \'1,120p\' src/web/lib/turns.ts && sed -n \'1,120p\' src/web/components/Timeline.tsx',
  );

  assert.deepEqual(
    commands.map((command) => command.type),
    ["search", "read", "read"],
  );

  if (commands[1]?.type !== "read" || commands[2]?.type !== "read") {
    assert.fail("expected read commands");
  }
  assert.deepEqual(
    [commands[1].name, commands[2].name],
    ["turns.ts", "Timeline.tsx"],
  );
});

test("extractExecCommandText strips bash wrapper from exec invocation", () => {
  const commandText = extractExecCommandText(
    JSON.stringify({
      cmd: "/usr/bin/bash -lc \"sed -n '1,120p' src/web/components/Timeline.tsx\"",
    }),
  );

  assert.equal(commandText, "sed -n '1,120p' src/web/components/Timeline.tsx");
});

test("extractNestedExecCommandTexts reads cmds from code-mode exec scripts", () => {
  const script = `const results = await Promise.all([
  tools.exec_command({
    cmd: "find . -maxdepth 3 -type d -name .git -print | sort",
    workdir: "/home/zia/project/AgentHubProject",
    yield_time_ms: 10000,
    max_output_tokens: 4000
  }),
  tools.exec_command({
    cmd: "rg --files -g 'AGENTS.md' | sort",
    workdir: "/home/zia/project/AgentHubProject"
  }),
  tools.exec_command({
    cmd: "sed -n '1,280p' docs/code-agent-ppt-e2e-test.md",
    workdir: "/home/zia/project/AgentHubProject"
  })
]);`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "find . -maxdepth 3 -type d -name .git -print | sort",
    "rg --files -g 'AGENTS.md' | sort",
    "sed -n '1,280p' docs/code-agent-ppt-e2e-test.md",
  ]);
});

test("extractShellCommandTexts supports both exec_command JSON and code-mode exec", () => {
  assert.deepEqual(
    extractShellCommandTexts(
      "exec_command",
      JSON.stringify({ cmd: "rg -n TODO src" }),
    ),
    ["rg -n TODO src"],
  );

  const script = `const result = await tools.exec_command({
  cmd: "sed -n '1,240p' /tmp/foo.md",
  yield_time_ms: 10000
});
text(result.output);`;

  assert.deepEqual(extractShellCommandTexts("exec", script), [
    "sed -n '1,240p' /tmp/foo.md",
  ]);
  assert.equal(
    shellCommandTextFromInvocation("exec", script),
    "sed -n '1,240p' /tmp/foo.md",
  );
});
