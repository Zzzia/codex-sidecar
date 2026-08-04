import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractNestedUpdatePlans,
  isUpdatePlanOnlyCodeModeScript,
} from "./codeModeUpdatePlan.js";
import {
  extractNestedWriteStdinActions,
  extractShellCommandTexts,
} from "./commandSemantics.js";

test("extractNestedUpdatePlans reads inline plan arrays", () => {
  const script = `const result = await tools.update_plan({
  plan: [
    { step: "完整读取四个 Skill", status: "completed" },
    { step: "给出推荐流程", status: "in_progress" }
  ]
});
text(result);`;

  assert.deepEqual(extractNestedUpdatePlans(script), [
    {
      explanation: "",
      items: [
        { step: "完整读取四个 Skill", status: "completed" },
        { step: "给出推荐流程", status: "in_progress" },
      ],
    },
  ]);
});

test("extractNestedUpdatePlans resolves nearby plan variable references", () => {
  const script = `const plan = [
  { step: "梳理链路", status: "completed" },
  { step: "实现修复", status: "in_progress" }
];
const res = await tools.update_plan({
  explanation: "继续推进",
  plan
});
text(res);`;

  assert.deepEqual(extractNestedUpdatePlans(script), [
    {
      explanation: "继续推进",
      items: [
        { step: "梳理链路", status: "completed" },
        { step: "实现修复", status: "in_progress" },
      ],
    },
  ]);
});

test("isUpdatePlanOnlyCodeModeScript keeps mixed shell scripts visible", () => {
  const purePlan = `const result = await tools.update_plan({plan:[
  {step:"一步",status:"in_progress"}
]});
text(result);`;
  const mixed = `const plan = await tools.update_plan({plan:[
  {step:"一步",status:"in_progress"}
]});
const out = await tools.exec_command({cmd:"ls"});
text(plan);
text(out);`;

  assert.equal(
    isUpdatePlanOnlyCodeModeScript(
      purePlan,
      extractShellCommandTexts("exec", purePlan).length > 0 ||
        extractNestedWriteStdinActions(purePlan).length > 0,
    ),
    true,
  );
  assert.equal(
    isUpdatePlanOnlyCodeModeScript(
      mixed,
      extractShellCommandTexts("exec", mixed).length > 0 ||
        extractNestedWriteStdinActions(mixed).length > 0,
    ),
    false,
  );
});
