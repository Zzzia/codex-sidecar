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

test("extractNestedExecCommandTexts keeps template-literal cmds with placeholders", () => {
  const script = `const specs = [
  {repo:"lighten-agent-runtime", branches:["master","codex/code-agent-base-runtime"]},
  {repo:"toolkit-center", branches:["master","codex/code-agent-control-plane"]}
];
const results = [];
for (const spec of specs) {
  const refspecs = spec.branches.map(b => \`+refs/heads/\${b}:refs/remotes/origin/\${b}\`).join(" ");
  const r = await tools.exec_command({
    cmd: \`git fetch origin \${refspecs}\`,
    workdir: \`/home/zia/project/AgentHubProject/\${spec.repo}\`,
    yield_time_ms: 30000,
    max_output_tokens: 12000
  });
  results.push({repo:spec.repo, output:r.output});
}`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "git fetch origin ${refspecs}",
  ]);
});

test("extractNestedExecCommandTexts resolves cmd references from nearby specs objects", () => {
  const script = `const jobs = [
  {
    name: "runtime",
    workdir: "/tmp/runtime",
    cmd: "git status --short"
  },
  {
    name: "toolkit",
    workdir: "/tmp/toolkit",
    cmd: "rg -n CodeAgent src | head -n 40"
  }
];
for (const j of jobs) {
  await tools.exec_command({
    cmd: j.cmd,
    workdir: j.workdir,
    yield_time_ms: 10000
  });
}`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "git status --short",
    "rg -n CodeAgent src | head -n 40",
  ]);
});

test("extractNestedExecCommandTexts supports functions.exec_command array entries", () => {
  const script = `const calls = [
  ["functions.exec_command", {
    cmd: "sed -n '1,240p' pyproject.toml",
    workdir: "/tmp/orch",
    yield_time_ms: 10000
  }],
  ["functions.exec_command", {
    cmd: "rg -n CodeAgent src",
    workdir: "/tmp/runtime"
  }]
];`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "sed -n '1,240p' pyproject.toml",
    "rg -n CodeAgent src",
  ]);
});

test("extractNestedExecCommandTexts accepts JSON-style object argument", () => {
  const script =
    'const r = await tools.exec_command({"cmd":"git status --short && rg -n foo","workdir":"/tmp"}); text(r.output);';

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "git status --short && rg -n foo",
  ]);
});

test("extractNestedExecCommandTexts resolves tools.exec_command(args) from call table", () => {
  const script = `const calls = [
  ["tc-status", {cmd:"git status --short",workdir:"/tmp/tc",yield_time_ms:10000}],
  ["runtime-status", {cmd:"rg -n CodeAgent src",workdir:"/tmp/rt",yield_time_ms:10000}]
];
const out = await Promise.all(calls.map(async ([name,args]) => {
  const r = await tools.exec_command(args);
  return {name,...r};
}));
for (const r of out) text(\`## \${r.name}\\n\${r.output}\`);`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "git status --short",
    "rg -n CodeAgent src",
  ]);
});

test("extractNestedExecCommandTexts resolves shorthand {cmd} from label/command tuples", () => {
  const script = `const pushes = [
  ["skill_studio","git push origin HEAD:jiangzilai/dual-agent-kind"],
  ["lighten-agent-runtime","git push origin HEAD:jiangzilai/code-agent-runtime-ppt-e2e-test"],
  ["lighten-agent-orchestrator","git push origin HEAD:jiangzilai/code-agent-lifecycle-ppt-e2e-master"],
  ["toolkit-center","git push origin HEAD:jiangzilai/code-agent-control-plane-ppt-e2e-test"]
];
const base="/home/zia/project/AgentHubProject";
const results=await Promise.all(pushes.map(([repo,cmd])=>tools.exec_command({
  cmd,
  workdir:\`\${base}/\${repo}\`,
  yield_time_ms:30000,
  max_output_tokens:8000
})));
for(let i=0;i<pushes.length;i++) text(JSON.stringify({repo:pushes[i][0],exit_code:results[i].exit_code,output:results[i].output}));`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "git push origin HEAD:jiangzilai/dual-agent-kind",
    "git push origin HEAD:jiangzilai/code-agent-runtime-ppt-e2e-test",
    "git push origin HEAD:jiangzilai/code-agent-lifecycle-ppt-e2e-master",
    "git push origin HEAD:jiangzilai/code-agent-control-plane-ppt-e2e-test",
  ]);
});

test("extractNestedExecCommandTexts resolves shorthand {cmd} from string command maps", () => {
  const script = `const root="/home/zia/project/AgentHubProject";
const pushes={
  "skill_studio":"git push origin HEAD:refs/heads/jiangzilai/dual-agent-kind",
  "toolkit-center":"git push origin HEAD:refs/heads/jiangzilai/code-agent-control-plane-ppt-e2e-test"
};
const results=await Promise.all(Object.entries(pushes).map(async ([repo,cmd])=>{
  const r=await tools.exec_command({cmd,workdir:\`\${root}/\${repo}\`,yield_time_ms:30000});
  return {repo,...r};
}));`;

  assert.deepEqual(extractNestedExecCommandTexts(script), [
    "git push origin HEAD:refs/heads/jiangzilai/dual-agent-kind",
    "git push origin HEAD:refs/heads/jiangzilai/code-agent-control-plane-ppt-e2e-test",
  ]);
});

test("shellToolDisplayTextFromInvocation summarizes write_stdin Ctrl-C sessions", async () => {
  const { shellToolDisplayTextFromInvocation } = await import("./commandSemantics.js");
  const script = `const results = await Promise.all([
  tools.write_stdin({session_id:75736, chars:"\\u0003", yield_time_ms:1000, max_output_tokens:4000}),
  tools.write_stdin({session_id:40445, chars:"\\u0003", yield_time_ms:1000, max_output_tokens:4000}),
  tools.write_stdin({session_id:84883, chars:"\\u0003", yield_time_ms:1000, max_output_tokens:4000})
]);
for (const [i,r] of results.entries()) text(JSON.stringify({service:["skill_studio","toolkit","orchestrator"][i],exit_code:r.exit_code,output:r.output}));`;

  assert.equal(
    shellToolDisplayTextFromInvocation("exec", script),
    "Ctrl-C · sessions 75736, 40445, 84883",
  );
});
