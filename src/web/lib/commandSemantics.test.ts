import test from "node:test";
import assert from "node:assert/strict";
import { extractExecCommandText, parseExecCommand } from "./commandSemantics.js";

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
